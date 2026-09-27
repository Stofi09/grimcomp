import { isIP } from 'node:net';

// Client identity and in-memory counters for rate limiting. The account server
// runs as a single process by design, so counters need no shared storage.

const MAX_FORWARDED_BYTES = 4096;
const MAX_FORWARDED_HOPS = 32;

function normalizeAddress(value) {
  if (typeof value !== 'string') return null;
  const version = isIP(value);
  if (version === 4) return value;
  // Scope identifiers are interface names, not plain IP address literals.
  if (version !== 6 || value.includes('%')) return null;

  const address = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(address);
  if (!mapped) return address;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

/** Resolve a rate-limit address through an explicitly trusted proxy chain. */
export function createClientAddressResolver(trustedProxies = []) {
  if (!Array.isArray(trustedProxies)) {
    throw new TypeError('trustedProxies must be an array of exact IPv4 or IPv6 address literals.');
  }
  const trusted = new Set(Array.from(trustedProxies, (value, index) => {
    const address = normalizeAddress(value);
    if (!address) {
      throw new TypeError(`trustedProxies[${index}] must be an exact IPv4 or IPv6 address literal; hostnames, CIDR ranges, and wildcards are not supported.`);
    }
    return address;
  }));

  return function clientAddress(request) {
    const peer = normalizeAddress(request.socket?.remoteAddress) ?? 'unknown';
    if (!trusted.has(peer)) return peer;

    const forwarded = request.headers?.['x-forwarded-for'];
    if (typeof forwarded !== 'string' || forwarded.length > MAX_FORWARDED_BYTES
      || Buffer.byteLength(forwarded, 'utf8') > MAX_FORWARDED_BYTES) return peer;
    const hops = forwarded.split(',');
    if (hops.length > MAX_FORWARDED_HOPS) return peer;
    const addresses = hops.map(value => normalizeAddress(value.trim()));
    // Reject the whole chain rather than skipping a malformed hop and trusting
    // a client-controlled address farther to the left.
    if (addresses.some(address => address === null)) return peer;

    for (let index = addresses.length - 1; index >= 0; index -= 1) {
      if (!trusted.has(addresses[index])) return addresses[index];
    }
    return peer;
  };
}

/**
 * The rate-limit bucket for a resolved client address. IPv4 clients are
 * limited per address. One IPv6 subscriber normally controls a whole /64, so
 * per-address buckets would give it 2^64 fresh limits; IPv6 is bucketed per /64.
 */
export function rateLimitNetwork(address) {
  if (typeof address !== 'string' || isIP(address) !== 6 || address.includes('%')) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [head, tail] = canonical.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined
    ? left
    : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return `${new URL(`http://[${groups.slice(0, 4).join(':')}::]/`).hostname.slice(1, -1)}/64`;
}

/**
 * Fixed-window attempt counters kept in process memory. Every window has the
 * same length, so Map insertion order is also expiry order: pruning stops at
 * the first live entry, and a full table evicts the entry closest to expiry
 * instead of refusing unrelated clients.
 */
export function createRateLimiter({ limit, windowMs, maxEntries = 10_000 }) {
  if (![limit, windowMs, maxEntries].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError('Rate limits need positive whole-number limit, windowMs and maxEntries values.');
  }
  const entries = new Map();

  function prune(timestamp) {
    for (const [key, entry] of entries) {
      if (entry.resetAt > timestamp) break;
      entries.delete(key);
    }
  }

  return {
    /** Seconds until `key` may try again, or 0 while it is under the limit. Never mutates. */
    retryAfter(key, timestamp) {
      const entry = entries.get(key);
      if (!entry || entry.resetAt <= timestamp || entry.count < limit) return 0;
      return Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000));
    },
    /** Count one attempt for `key`. */
    hit(key, timestamp) {
      prune(timestamp);
      let entry = entries.get(key);
      if (entry && entry.resetAt <= timestamp) {
        entries.delete(key);
        entry = undefined;
      }
      if (!entry) {
        while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
        entry = { count: 0, resetAt: timestamp + windowMs };
        entries.set(key, entry);
      }
      entry.count += 1;
    },
    /** Forget `key`, for example after a successful sign-in. */
    reset(key) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
}
