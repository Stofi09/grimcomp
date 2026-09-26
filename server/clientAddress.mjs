import { isIP } from 'node:net';

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
