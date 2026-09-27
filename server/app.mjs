import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { openDatabase } from './database.mjs';
import { createClientAddressResolver, createRateLimiter, rateLimitNetwork } from './clientAddress.mjs';

const scryptAsync = promisify(scrypt);
// Parameters for new password hashes. Each stored hash records its own
// (`scrypt$N$r$p$salt$key`); outdated ones are upgraded at the next sign-in.
const SCRYPT = Object.freeze({ N: 32_768, r: 8, p: 3, saltBytes: 16, keyBytes: 64 });
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
// Stored parameters above this work factor (N·r·p) are refused, never run.
const SCRYPT_MAX_WORK = 2 ** 22;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_BACKUP_BYTES = 960 * 1024;
// JSON.stringify of valid JSON text at most doubles its UTF-8 size: it escapes
// only `"`, `\`, tab, LF and CR (1 → 2 bytes) and lone surrogates (3 → 6).
// A larger body can only come from a client padding its JSON.
export const MAX_BACKUP_REQUEST_BYTES = 2 * MAX_BACKUP_BYTES + 4_096;
const MAX_AUTH_REQUEST_BYTES = 4_096;
export const REGISTRATION_MODES = Object.freeze(['open', 'closed', 'invite']);
const COOKIE_NAME = 'grimcomp_session';
export const REFERRER_POLICY = 'same-origin';
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';
// The built web app loads only same-origin scripts, styles, JSON and fonts
// (Vite inlines the smallest fonts as data: URIs). React applies style props
// through CSSOM, which style-src does not restrict, so no 'unsafe-inline'.
export const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'",
  "font-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
// API JSON and every other non-HTML response: nothing may load or frame it.
export const DEFAULT_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";
// Vite's content-hashed build output, for example index-BDiERoRh.css.
const FINGERPRINTED_ASSET = /^[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/;

const SESSION_EXPIRED = 'Your session has expired. Please sign in.';
const ACCOUNT_CHANGED = 'Your account changed in another window. Refresh your session before trying again.';
const INVALID_LOGIN = 'Email or password is incorrect.';
const EMAIL_TAKEN = 'An account with this email already exists. Sign in instead.';
const PASSWORD_CHANGED_ELSEWHERE = 'Your password was changed elsewhere. Sign in again, then retry.';
const TOO_MANY_ATTEMPTS = 'Too many attempts. Please try again later.';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const iso = (timestamp) => new Date(timestamp).toISOString();
const publicUser = (row) => ({ id: row.id, name: row.name, email: row.email });
const backupInfo = (row) => ({ id: row.id, createdAt: iso(row.created_at), bytes: row.bytes });
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

class HttpError extends Error {
  constructor(status, message, { code, headers } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(response, status, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(payload === undefined ? {} : { 'Content-Length': Buffer.byteLength(payload) }),
  });
  response.end(payload);
}

/** Code and message only; never request bodies, credentials or tokens. */
function describeError(error) {
  const code = error?.code ?? error?.name ?? 'Error';
  const message = String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 300);
  return `${code}: ${message}`;
}

function readJson(request, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Send JSON using application/json.');
  }
  if (Number(request.headers['content-length'] ?? 0) > limit) {
    request.resume();
    throw new HttpError(413, 'Request is too large.');
  }
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    const chunks = [];
    const cleanup = () => {
      request.off('data', data);
      request.off('end', end);
      request.off('error', fail);
      request.off('aborted', aborted);
      request.off('close', aborted);
    };
    const fail = (error) => { cleanup(); reject(error); };
    const aborted = () => fail(new HttpError(400, 'Request was interrupted.'));
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        fail(new HttpError(413, 'Request is too large.'));
        request.resume();
      } else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!isRecord(parsed)) throw new Error();
        resolveBody(parsed);
      } catch { reject(new HttpError(400, 'Request must be a JSON object.')); }
    };
    request.on('data', data);
    request.on('end', end);
    request.on('error', fail);
    request.on('aborted', aborted);
    // A closed connection settles the read, so every upload slot is released.
    request.on('close', aborted);
  });
}

function credentials(body, registration) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  const password = passwordField(body.password, registration ? 12 : 1,
    registration ? 'Use a password between 12 and 128 characters.' : 'Enter your password.');
  const name = typeof body.name === 'string' ? body.name.trim() : email.split('@')[0];
  if (registration && (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name))) {
    throw new HttpError(400, 'Enter a name between 1 and 80 characters.');
  }
  return { email, password, name };
}

function passwordField(value, minimum, message) {
  if (typeof value !== 'string' || value.length < minimum || value.length > 128) throw new HttpError(400, message);
  return value;
}

function validateSnapshot(snapshot) {
  if (typeof snapshot !== 'string') throw new HttpError(400, 'Provide a Grim Companion backup.');
  const bytes = Buffer.byteLength(snapshot, 'utf8');
  if (bytes > MAX_BACKUP_BYTES) throw new HttpError(413, 'Backups must be at most 960 KiB.');
  let parsed;
  try { parsed = JSON.parse(snapshot); } catch { throw new HttpError(400, 'Backup is not valid JSON.'); }
  if (!isRecord(parsed) || parsed.$schema !== 'grimcomp.v1' || !['roster', 'character'].includes(parsed.scope)) {
    throw new HttpError(400, 'Use a grimcomp.v1 character or roster backup.');
  }
  const metadata = new Set(['$schema', 'scope', 'exportedAt', 'character']);
  const keys = Object.keys(parsed).filter(key => !metadata.has(key));
  if (keys.length === 0 || keys.length > 1_000) throw new HttpError(400, 'Backup must contain between 1 and 1,000 saved data keys.');
  for (const key of keys) {
    if (!key.startsWith('gc.') || key.length > 256 || key.trim() !== key
      || /[\u0000-\u001f\u007f]/u.test(key) || key.startsWith('gc.storage')
      || key.startsWith('gc.auth.') || key.startsWith('gc.account.')
      || key === 'gc.newchar.draft' || key === 'gc.newchar.step') {
      throw new HttpError(400, 'Backup contains unsupported or internal storage keys.');
    }
  }
  // Gameplay-specific validation remains in each platform's transactional importer.
  return bytes;
}

/**
 * Parse a stored `scrypt$N$r$p$salt$key` hash. Anything malformed, or with
 * parameters outside sane CPU and memory bounds, yields null so sign-in fails
 * with 401 instead of running unbounded work or throwing.
 */
export function parsePasswordHash(stored) {
  if (typeof stored !== 'string' || stored.length > 512) return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  if (!parts.slice(1, 4).every(value => /^[1-9][0-9]{0,6}$/.test(value))) return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const [salt, key] = parts.slice(4);
  const bounded = N >= 2 ** 10 && N <= 2 ** 20 && Number.isInteger(Math.log2(N))
    && r <= 32 && p <= 16 && N * r * p <= SCRYPT_MAX_WORK
    && 128 * r * (N + p + 2) <= SCRYPT_MAXMEM;
  if (!bounded || !/^(?:[0-9a-f]{2}){16,64}$/.test(salt) || !/^(?:[0-9a-f]{2}){16,128}$/.test(key)) return null;
  return { N, r, p, salt, key: Buffer.from(key, 'hex') };
}

const isCurrentHash = ({ N, r, p, salt, key }) => N === SCRYPT.N && r === SCRYPT.r && p === SCRYPT.p
  && salt.length === SCRYPT.saltBytes * 2 && key.length === SCRYPT.keyBytes;

/**
 * Run at most `concurrency` tasks at once. Later callers wait in FIFO order;
 * a full queue or an expired wait is refused with 503 instead of piling up.
 */
function createWorkQueue({ concurrency, limit, timeoutMs, busyMessage }) {
  let active = 0;
  const waiting = [];
  const busy = () => new HttpError(503, busyMessage, { headers: { 'Retry-After': '2' } });

  function acquire() {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve();
    }
    if (waiting.length >= limit) return Promise.reject(busy());
    return new Promise((start, reject) => {
      const waiter = { start };
      waiter.timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(waiter), 1);
        reject(busy());
      }, timeoutMs);
      waiter.timer.unref?.();
      waiting.push(waiter);
    });
  }

  function release() {
    const next = waiting.shift();
    if (!next) {
      active -= 1;
      return;
    }
    // Hand the slot straight to the oldest waiter.
    clearTimeout(next.timer);
    next.start();
  }

  return async (task) => {
    await acquire();
    try { return await task(); }
    finally { release(); }
  };
}

function registrationPolicy(mode, inviteCode) {
  if (!REGISTRATION_MODES.includes(mode)) {
    throw new TypeError(`registrationMode must be one of: ${REGISTRATION_MODES.join(', ')}.`);
  }
  if (mode !== 'invite') return { mode };
  const code = typeof inviteCode === 'string' ? inviteCode.trim() : '';
  if (code.length < 12 || code.length > 256) {
    throw new TypeError('Invite-only registration needs an invite code of 12 to 256 characters.');
  }
  // Offered codes are trimmed too, so pasted whitespace never matters.
  return { mode, invite: createHash('sha256').update(code).digest() };
}

// Compare fixed-length digests, so neither the code nor its length leaks through timing.
function inviteAccepted(policy, candidate) {
  const offered = createHash('sha256').update(typeof candidate === 'string' ? candidate.trim() : '').digest();
  return timingSafeEqual(offered, policy.invite);
}

function positiveInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive whole number.`);
}

export function createApplication({
  databasePath = ':memory:',
  allowedOrigins = ['http://localhost:5173'],
  secureCookies = false,
  now = () => Date.now(),
  rateLimit = 30,
  failedLoginLimit = 10,
  backupRateLimit = 60,
  rateWindowMs = 15 * 60 * 1000,
  rateLimitEntries = 10_000,
  trustedProxies = [],
  registrationMode = 'open',
  registrationInviteCode,
  maxAccounts = 1_000,
  maxBackupStorageBytes = 2 * 1024 ** 3,
  maxConcurrentUploads = 4,
  hashConcurrency = 4,
  hashQueueLimit = 32,
  hashQueueTimeoutMs = 5_000,
  deriveKey = scryptAsync,
  staticDir,
} = {}) {
  const registration = registrationPolicy(registrationMode, registrationInviteCode);
  for (const [name, value] of Object.entries({ maxAccounts, maxBackupStorageBytes, maxConcurrentUploads, hashConcurrency })) {
    positiveInteger(name, value);
  }
  const clientAddress = createClientAddressResolver(trustedProxies);
  const clientNetwork = (request) => rateLimitNetwork(clientAddress(request));
  const limiters = {
    // Every credential attempt (register, login, password change, deletion) per network.
    network: createRateLimiter({ limit: rateLimit, windowMs: rateWindowMs, maxEntries: rateLimitEntries }),
    // Wrong passwords per account and network: strangers cannot lock the owner out.
    failures: createRateLimiter({ limit: failedLoginLimit, windowMs: rateWindowMs, maxEntries: rateLimitEntries }),
    // Backup and session writes per signed-in account.
    account: createRateLimiter({ limit: backupRateLimit, windowMs: rateWindowMs, maxEntries: rateLimitEntries }),
  };
  const hashing = createWorkQueue({
    concurrency: hashConcurrency, limit: hashQueueLimit, timeoutMs: hashQueueTimeoutMs,
    busyMessage: 'Sign-in is busy. Please try again shortly.',
  });
  const uploads = { active: 0, accounts: new Set() };
  const database = openDatabase(databasePath);
  const origins = new Set(allowedOrigins);
  const dummySalt = randomBytes(SCRYPT.saltBytes).toString('hex');
  const dummyKey = Buffer.alloc(SCRYPT.keyBytes);

  // Over-limit requests stop here: no body read, no hashing, no database write.
  function enforce(limiter, key, timestamp) {
    const seconds = limiter.retryAfter(key, timestamp);
    if (seconds > 0) throw new HttpError(429, TOO_MANY_ATTEMPTS, { headers: { 'Retry-After': String(seconds) } });
  }

  function consume(limiter, key, timestamp) {
    enforce(limiter, key, timestamp);
    limiter.hit(key, timestamp);
  }

  function derive(password, salt, keyBytes, { N, r, p }) {
    return hashing(() => deriveKey(password, salt, keyBytes, { N, r, p, maxmem: SCRYPT_MAXMEM }));
  }

  async function createPasswordHash(password) {
    const salt = randomBytes(SCRYPT.saltBytes).toString('hex');
    const key = await derive(password, salt, SCRYPT.keyBytes, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${key.toString('hex')}`;
  }

  /** The parsed stored hash when `password` matches it, otherwise null. */
  async function verifyPassword(password, stored) {
    const parsed = parsePasswordHash(stored);
    // Unknown accounts and unreadable hashes still pay for one current-cost hash.
    const target = parsed ?? { ...SCRYPT, salt: dummySalt, key: dummyKey };
    let candidate;
    try {
      candidate = await derive(password, target.salt, target.key.length, target);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error('A stored password hash could not be checked:', describeError(error));
      return null;
    }
    const matches = candidate.length === target.key.length && timingSafeEqual(candidate, target.key);
    return parsed && matches ? parsed : null;
  }

  function reserveUpload(userId) {
    if (uploads.accounts.has(userId)) {
      throw new HttpError(429, 'Another backup upload for this account is still in progress. Wait for it to finish.',
        { headers: { 'Retry-After': '5' } });
    }
    if (uploads.active >= maxConcurrentUploads) {
      throw new HttpError(503, 'The server is busy saving other backups. Please try again shortly.',
        { headers: { 'Retry-After': '5' } });
    }
    uploads.active += 1;
    uploads.accounts.add(userId);
    return () => {
      uploads.active -= 1;
      uploads.accounts.delete(userId);
    };
  }

  function setCookie(response, token, maxAge) {
    response.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`);
  }

  function sessionToken(request) {
    if (request.headers['x-grim-client'] === 'native') {
      return /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1];
    }
    const tokens = (request.headers.cookie ?? '').split(';').map(part => part.trim())
      .filter(part => part.startsWith(`${COOKIE_NAME}=`))
      .map(part => part.slice(COOKIE_NAME.length + 1));
    // A sibling subdomain or a narrower path can plant a second cookie with this
    // name ("cookie tossing"). Never guess which one the browser meant.
    return tokens.length === 1 ? tokens[0] : undefined;
  }

  function session(request, timestamp) {
    const token = sessionToken(request);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return database.prepare(`SELECT users.id, users.email, users.name, sessions.expires_at, sessions.token_hash
      FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?`).get(hash(token), timestamp) ?? null;
  }

  function transaction(work) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }
  }

  function issueSession(request, response, user, status, inTransaction) {
    const token = randomBytes(32).toString('hex');
    const timestamp = now();
    const expiresAt = timestamp + SESSION_MS;
    // Keep account changes and session rotation atomic. A disk/write failure
    // must neither strand a new account nor revoke the last usable session.
    transaction(() => {
      inTransaction?.();
      database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(timestamp);
      const previous = session(request, timestamp);
      if (previous) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(previous.token_hash);
      database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hash(token), user.id, expiresAt);
    });
    const native = request.headers['x-grim-client'] === 'native';
    if (!native) setCookie(response, token, SESSION_MS / 1000);
    json(response, status, { user: publicUser(user), expiresAt: iso(expiresAt), ...(native ? { token } : {}) });
  }

  function requireAccount(request, auth) {
    if (!auth) throw new HttpError(401, SESSION_EXPIRED);
    if (request.headers['x-grim-user'] && request.headers['x-grim-user'] !== auth.id) {
      throw new HttpError(409, ACCOUNT_CHANGED);
    }
    return auth;
  }

  /** After awaiting, confirm the request's session still belongs to `auth`. */
  function assertSameSession(request, auth) {
    const current = session(request, now());
    if (!current || current.id !== auth.id) throw new HttpError(401, SESSION_EXPIRED);
  }

  function storedPasswordHash(userId) {
    return database.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId)?.password_hash;
  }

  /** Check a signed-in account's password under the same failure limits as sign-in. */
  async function confirmPassword(request, auth, password, timestamp, message) {
    const failureKey = `${clientNetwork(request)} ${auth.email}`;
    enforce(limiters.failures, failureKey, timestamp);
    const stored = storedPasswordHash(auth.id);
    if (!await verifyPassword(password, stored)) {
      limiters.failures.hit(failureKey, now());
      // Not 401: the session is still valid, and clients treat 401 as signed out.
      throw new HttpError(403, message);
    }
    limiters.failures.reset(failureKey);
    return stored;
  }

  function assertAccountCapacity() {
    if (database.prepare('SELECT COUNT(*) AS count FROM users').get().count >= maxAccounts) {
      throw new HttpError(403, 'This server has reached its account limit and is not accepting new accounts.',
        { code: 'account_limit' });
    }
  }

  function assertBackupStorage() {
    // octet_length() reads each snapshot's size from its record header. The
    // later `bytes` column would walk every snapshot's overflow pages.
    const { total } = database.prepare('SELECT COALESCE(SUM(octet_length(snapshot)), 0) AS total FROM backups').get();
    if (total > maxBackupStorageBytes) {
      throw new HttpError(507, "The server's backup storage is full. Delete an older backup or try again later.",
        { code: 'storage_full' });
    }
  }

  function health(response) {
    try {
      database.prepare('SELECT 1 FROM users LIMIT 1').get();
    } catch (error) {
      console.error('Health check failed:', describeError(error));
      return json(response, 503, { ok: false, error: 'The account database is unavailable.' });
    }
    return json(response, 200, { ok: true });
  }

  function logout(response, auth, client) {
    if (auth) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(auth.token_hash);
    if (client === 'web') setCookie(response, '', 0);
    return json(response, 204);
  }

  function logoutEverywhere(response, auth, client, timestamp) {
    consume(limiters.account, auth.id, timestamp);
    database.prepare('DELETE FROM sessions WHERE user_id = ?').run(auth.id);
    if (client === 'web') setCookie(response, '', 0);
    return json(response, 204);
  }

  async function register(request, response, timestamp) {
    if (registration.mode === 'closed') {
      throw new HttpError(403, 'This server is not accepting new accounts. You can still sign in to an existing account.',
        { code: 'registration_closed' });
    }
    // Forwarded addresses count only through explicitly configured proxies.
    consume(limiters.network, clientNetwork(request), timestamp);
    const body = await readJson(request, MAX_AUTH_REQUEST_BYTES);
    const { email, password, name } = credentials(body, true);
    if (registration.mode === 'invite' && !inviteAccepted(registration, body.inviteCode)) {
      throw new HttpError(403, 'Enter the invite code from the server owner to create an account.',
        { code: 'invite_required' });
    }
    assertAccountCapacity();
    // Hash before looking up the email, so an existing address takes as long
    // as a new one and response timing does not reveal who is registered.
    const passwordHash = await createPasswordHash(password);
    if (database.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, EMAIL_TAKEN);
    const user = { id: randomUUID(), email, name };
    return issueSession(request, response, user, 201, () => {
      assertAccountCapacity();
      try {
        database.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, email, name, passwordHash, timestamp);
      } catch (error) {
        if (database.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, EMAIL_TAKEN);
        throw error;
      }
    });
  }

  async function login(request, response, timestamp) {
    const network = clientNetwork(request);
    consume(limiters.network, network, timestamp);
    const { email, password } = credentials(await readJson(request, MAX_AUTH_REQUEST_BYTES), false);
    // Only wrong passwords count, per account and network, so a stranger on
    // another network cannot lock the owner out by failing on purpose.
    const failureKey = `${network} ${email}`;
    enforce(limiters.failures, failureKey, timestamp);
    const user = database.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').get(email);
    const verified = await verifyPassword(password, user?.password_hash);
    if (!user || !verified) {
      limiters.failures.hit(failureKey, now());
      throw new HttpError(401, INVALID_LOGIN);
    }
    limiters.failures.reset(failureKey);
    // The upgrade is opportunistic: a busy hashing queue must not fail a correct sign-in.
    const upgraded = isCurrentHash(verified) ? null : await createPasswordHash(password).catch(error => {
      if (error instanceof HttpError) return null;
      throw error;
    });
    return issueSession(request, response, user, 200, () => {
      // The password may have changed, or the account been deleted, while hashing.
      if (storedPasswordHash(user.id) !== user.password_hash) throw new HttpError(401, INVALID_LOGIN);
      if (upgraded) database.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(upgraded, user.id);
    });
  }

  async function changePassword(request, response, auth, timestamp) {
    consume(limiters.network, clientNetwork(request), timestamp);
    const body = await readJson(request, MAX_AUTH_REQUEST_BYTES);
    const currentPassword = passwordField(body.currentPassword, 1, 'Enter your current password.');
    const newPassword = passwordField(body.newPassword, 12, 'Use a new password between 12 and 128 characters.');
    if (newPassword === currentPassword) throw new HttpError(400, 'Choose a new password that differs from your current one.');
    const stored = await confirmPassword(request, auth, currentPassword, timestamp, 'Your current password is incorrect.');
    const replacement = await createPasswordHash(newPassword);
    // Revoke every session, this one included, and issue this client a fresh
    // token, so even a copied token of this session stops working.
    return issueSession(request, response, auth, 200, () => {
      assertSameSession(request, auth);
      const changed = database.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?')
        .run(replacement, auth.id, stored);
      if (changed.changes !== 1) throw new HttpError(409, PASSWORD_CHANGED_ELSEWHERE);
      database.prepare('DELETE FROM sessions WHERE user_id = ?').run(auth.id);
    });
  }

  async function deleteAccount(request, response, auth, client, timestamp) {
    consume(limiters.network, clientNetwork(request), timestamp);
    const body = await readJson(request, MAX_AUTH_REQUEST_BYTES);
    const password = passwordField(body.password, 1, 'Enter your password to delete your account.');
    const stored = await confirmPassword(request, auth, password, timestamp, 'Your password is incorrect.');
    transaction(() => {
      assertSameSession(request, auth);
      // Sessions and backups follow through ON DELETE CASCADE.
      const deleted = database.prepare('DELETE FROM users WHERE id = ? AND password_hash = ?').run(auth.id, stored);
      if (deleted.changes !== 1) throw new HttpError(409, PASSWORD_CHANGED_ELSEWHERE);
    });
    if (client === 'web') setCookie(response, '', 0);
    return json(response, 204);
  }

  function listBackups(response, auth) {
    const rows = database.prepare('SELECT id, created_at, bytes FROM backups WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(auth.id);
    return json(response, 200, { backups: rows.map(backupInfo) });
  }

  async function saveBackup(request, response, auth, timestamp) {
    enforce(limiters.account, auth.id, timestamp);
    // Refuse before reading: every body in flight is held in memory.
    const release = reserveUpload(auth.id);
    try {
      limiters.account.hit(auth.id, timestamp);
      const { snapshot } = await readJson(request, MAX_BACKUP_REQUEST_BYTES);
      const bytes = validateSnapshot(snapshot);
      const backup = { id: randomUUID(), bytes, created_at: now() };
      transaction(() => {
        // Recheck after asynchronous body reading so logout cannot race an upload.
        assertSameSession(request, auth);
        database.prepare('INSERT INTO backups (id, user_id, snapshot, bytes, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(backup.id, auth.id, snapshot, bytes, backup.created_at);
        database.prepare(`DELETE FROM backups WHERE user_id = ? AND id NOT IN
          (SELECT id FROM backups WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)`).run(auth.id, auth.id);
        // Measured after retention, so replacing an old backup is not refused.
        assertBackupStorage();
      });
      return json(response, 201, { backup: backupInfo(backup) });
    } finally {
      release();
    }
  }

  function readBackup(response, auth, id) {
    const row = database.prepare('SELECT * FROM backups WHERE id = ? AND user_id = ?').get(id, auth.id);
    if (!row) throw new HttpError(404, 'Backup not found.');
    return json(response, 200, { backup: backupInfo(row), snapshot: row.snapshot });
  }

  function deleteBackup(response, auth, id, timestamp) {
    consume(limiters.account, auth.id, timestamp);
    if (database.prepare('DELETE FROM backups WHERE id = ? AND user_id = ?').run(id, auth.id).changes === 0) {
      throw new HttpError(404, 'Backup not found.');
    }
    return json(response, 204);
  }

  async function handleApi(request, response, path) {
    response.setHeader('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) throw new HttpError(403, 'This origin is not allowed.');
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      if (!origin) throw new HttpError(403, 'An allowed origin is required.');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Grim-Client, X-Grim-User, Authorization');
      return json(response, 204);
    }
    if (path === '/api/health' && request.method === 'GET') return health(response);
    const client = request.headers['x-grim-client'];
    if (client !== 'web' && client !== 'native') throw new HttpError(403, 'An account client header is required.');
    if (client === 'web' && request.method !== 'GET' && !origin) throw new HttpError(403, 'An allowed browser origin is required.');
    const timestamp = now();
    const auth = session(request, timestamp);
    const account = () => requireAccount(request, auth);
    switch (`${request.method} ${path}`) {
      case 'GET /api/auth/session':
        return json(response, 200, auth ? { user: publicUser(auth), expiresAt: iso(auth.expires_at) } : { user: null });
      case 'GET /api/auth/registration': return json(response, 200, { mode: registration.mode });
      case 'POST /api/auth/register': return register(request, response, timestamp);
      case 'POST /api/auth/login': return login(request, response, timestamp);
      case 'POST /api/auth/logout': return logout(response, auth, client);
      case 'POST /api/auth/logout-all': return logoutEverywhere(response, account(), client, timestamp);
      case 'POST /api/auth/password': return changePassword(request, response, account(), timestamp);
      case 'DELETE /api/account': return deleteAccount(request, response, account(), client, timestamp);
      case 'GET /api/backups': return listBackups(response, account());
      case 'POST /api/backups': return saveBackup(request, response, account(), timestamp);
      default: break;
    }
    if (path === '/api/backups' || path.startsWith('/api/backups/')) {
      const owner = account();
      const id = /^\/api\/backups\/([a-f0-9-]{36})$/.exec(path)?.[1];
      if (id && request.method === 'GET') return readBackup(response, owner, id);
      if (id && request.method === 'DELETE') return deleteBackup(response, owner, id, timestamp);
    }
    throw new HttpError(404, 'Endpoint not found.');
  }

  async function serveStatic(request, response, path) {
    if (!staticDir || !['GET', 'HEAD'].includes(request.method)) throw new HttpError(404, 'Not found.');
    const root = resolve(staticDir);
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { throw new HttpError(400, 'Invalid URL.'); }
    let target = resolve(root, `.${decoded}`);
    if (!target.startsWith(root + sep) && target !== root) throw new HttpError(404, 'Not found.');
    if (decoded.split('/').some(segment => segment.startsWith('.'))) throw new HttpError(404, 'Not found.');
    try {
      if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
    } catch {
      if (extname(path) || !(request.headers.accept ?? '').includes('text/html')) throw new HttpError(404, 'Not found.');
      target = resolve(root, 'index.html');
    }
    let contents;
    try { contents = await readFile(target); } catch { throw new HttpError(404, 'Build the web app before serving it.'); }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
    const fingerprinted = dirname(target) === resolve(root, 'assets') && FINGERPRINTED_ASSET.test(basename(target));
    response.writeHead(200, {
      'Content-Type': types[extname(target)] ?? 'application/octet-stream',
      // Content-hashed build files never change; everything else revalidates.
      'Cache-Control': fingerprinted ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(extname(target) === '.html' ? { 'Content-Security-Policy': APP_CONTENT_SECURITY_POLICY } : {}),
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  }

  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', REFERRER_POLICY);
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', DEFAULT_CONTENT_SECURITY_POLICY);
    if (secureCookies) response.setHeader('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY);
    let path = '';
    Promise.resolve().then(() => {
      path = new URL(request.url, 'http://localhost').pathname;
      return path === '/api' || path.startsWith('/api/') ? handleApi(request, response, path) : serveStatic(request, response, path);
    }).catch(error => {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) return void response.destroy();
      if (error instanceof HttpError) {
        for (const [name, value] of Object.entries(error.headers ?? {})) response.setHeader(name, value);
        return json(response, error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) });
      }
      console.error(`Account request failed (${request.method} ${path.slice(0, 200)}):`, describeError(error));
      json(response, 500, { error: 'The server could not complete this request. Please try again.' });
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return {
    server,
    database,
    async close() {
      if (server.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      if (database.isOpen) database.close();
    },
  };
}
