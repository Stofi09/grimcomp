import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { openDatabase } from './database.mjs';
import { createClientAddressResolver } from './clientAddress.mjs';

const deriveKey = promisify(scrypt);
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_BACKUP_BYTES = 960 * 1024;
const COOKIE_NAME = 'grimcomp_session';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const iso = (timestamp) => new Date(timestamp).toISOString();
const publicUser = (row) => ({ id: row.id, name: row.name, email: row.email });
const backupInfo = (row) => ({ id: row.id, createdAt: iso(row.created_at), bytes: row.bytes });
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(response, status, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(payload === undefined ? {} : { 'Content-Length': Buffer.byteLength(payload) }),
  });
  response.end(payload);
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
  });
}

function credentials(body, registration) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  const password = body.password;
  if (typeof password !== 'string' || password.length > 128 || password.length < (registration ? 12 : 1)) {
    throw new HttpError(400, registration ? 'Use a password between 12 and 128 characters.' : 'Enter your password.');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : email.split('@')[0];
  if (registration && (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name))) {
    throw new HttpError(400, 'Enter a name between 1 and 80 characters.');
  }
  return { email, password, name };
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

export function createApplication({
  databasePath = ':memory:',
  allowedOrigins = ['http://localhost:5173'],
  secureCookies = false,
  now = () => Date.now(),
  rateLimit = 30,
  rateWindowMs = 15 * 60 * 1000,
  trustedProxies = [],
  staticDir,
} = {}) {
  const clientAddress = createClientAddressResolver(trustedProxies);
  const database = openDatabase(databasePath);
  const origins = new Set(allowedOrigins);
  const dummySalt = randomBytes(16).toString('hex');
  let activeHashes = 0;

  async function passwordKey(password, salt) {
    if (activeHashes >= 4) throw new HttpError(503, 'Sign-in is busy. Please try again shortly.');
    activeHashes++;
    try { return await deriveKey(password, salt, 64, SCRYPT_OPTIONS); }
    finally { activeHashes--; }
  }

  function rateCheck(key, response, timestamp, maximum = rateLimit) {
    database.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').run(timestamp);
    const row = database.prepare(`INSERT INTO rate_limits (key, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts, expires_at`).get(key, timestamp + rateWindowMs);
    if (row.attempts > maximum) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((row.expires_at - timestamp) / 1000))));
      throw new HttpError(429, 'Too many attempts. Please try again later.');
    }
  }

  function setCookie(response, token, maxAge) {
    response.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`);
  }

  function session(request, timestamp) {
    let token;
    if (request.headers['x-grim-client'] === 'native') {
      token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1];
    } else {
      token = (request.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    }
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return database.prepare(`SELECT users.id, users.email, users.name, sessions.expires_at, sessions.token_hash
      FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?`).get(hash(token), timestamp) ?? null;
  }

  function issueSession(request, response, user, timestamp, status, createUser) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = timestamp + SESSION_MS;
    // Keep account creation and session rotation atomic. A disk/write failure
    // must neither strand a new account nor revoke the last usable session.
    database.exec('BEGIN IMMEDIATE');
    try {
      createUser?.();
      database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(timestamp);
      const previous = session(request, timestamp);
      if (previous) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(previous.token_hash);
      database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hash(token), user.id, expiresAt);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    const native = request.headers['x-grim-client'] === 'native';
    if (!native) setCookie(response, token, SESSION_MS / 1000);
    json(response, status, { user: publicUser(user), expiresAt: iso(expiresAt), ...(native ? { token } : {}) });
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
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Grim-Client, X-Grim-User, Authorization');
      return json(response, 204);
    }
    if (path === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true });
    const client = request.headers['x-grim-client'];
    if (client !== 'web' && client !== 'native') throw new HttpError(403, 'An account client header is required.');
    if (client === 'web' && request.method !== 'GET' && !origin) throw new HttpError(403, 'An allowed browser origin is required.');
    const timestamp = now();
    const auth = session(request, timestamp);
    if (path === '/api/auth/session' && request.method === 'GET') {
      return json(response, 200, auth ? { user: publicUser(auth), expiresAt: iso(auth.expires_at) } : { user: null });
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      if (auth) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(auth.token_hash);
      if (client === 'web') setCookie(response, '', 0);
      return json(response, 204);
    }
    if ((path === '/api/auth/register' || path === '/api/auth/login') && request.method === 'POST') {
      // Forwarded addresses count only through explicitly configured proxies.
      const ip = clientAddress(request);
      rateCheck(`ip:${hash(ip)}`, response, timestamp);
      const registration = path.endsWith('/register');
      const { email, password, name } = credentials(await readJson(request, 4_096), registration);
      rateCheck(`email:${hash(email)}`, response, timestamp);
      const existing = database.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (registration) {
        if (existing) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
        const salt = randomBytes(16).toString('hex');
        const key = await passwordKey(password, salt);
        const user = { id: randomUUID(), email, name };
        return issueSession(request, response, user, now(), 201, () => {
          try {
            database.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(user.id, email, name, `scrypt$32768$8$3$${salt}$${key.toString('hex')}`, timestamp);
          } catch (error) {
            if (database.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
            throw error;
          }
        });
      }
      const parts = existing?.password_hash.split('$');
      const candidate = await passwordKey(password, parts?.[4] ?? dummySalt);
      const expected = parts ? Buffer.from(parts[5], 'hex') : Buffer.alloc(64);
      if (!existing || expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) {
        throw new HttpError(401, 'Email or password is incorrect.');
      }
      return issueSession(request, response, existing, now(), 200);
    }
    if (path === '/api/backups' || path.startsWith('/api/backups/')) {
      if (!auth) throw new HttpError(401, 'Your session has expired. Please sign in.');
      if (request.headers['x-grim-user'] && request.headers['x-grim-user'] !== auth.id) {
        throw new HttpError(409, 'Your account changed in another window. Refresh your session before trying again.');
      }
      if (path === '/api/backups' && request.method === 'GET') {
        const rows = database.prepare('SELECT id, created_at, bytes FROM backups WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(auth.id);
        return json(response, 200, { backups: rows.map(backupInfo) });
      }
      if (path === '/api/backups' && request.method === 'POST') {
        rateCheck(`backup:${auth.id}`, response, timestamp, 60);
        const { snapshot } = await readJson(request, MAX_BACKUP_BYTES * 6 + 4_096);
        const bytes = validateSnapshot(snapshot);
        // Recheck after asynchronous body reading so logout cannot race an upload.
        const current = session(request, now());
        if (!current || current.id !== auth.id) throw new HttpError(401, 'Your session has expired. Please sign in.');
        const backup = { id: randomUUID(), bytes, created_at: now() };
        database.exec('BEGIN IMMEDIATE');
        try {
          database.prepare('INSERT INTO backups (id, user_id, snapshot, bytes, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(backup.id, auth.id, snapshot, bytes, backup.created_at);
          database.prepare(`DELETE FROM backups WHERE user_id = ? AND id NOT IN
            (SELECT id FROM backups WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)`).run(auth.id, auth.id);
          database.exec('COMMIT');
        } catch (error) { database.exec('ROLLBACK'); throw error; }
        return json(response, 201, { backup: backupInfo(backup) });
      }
      if (request.method === 'GET' && /^\/api\/backups\/[a-f0-9-]{36}$/.test(path)) {
        const row = database.prepare('SELECT * FROM backups WHERE id = ? AND user_id = ?').get(path.split('/').at(-1), auth.id);
        if (!row) throw new HttpError(404, 'Backup not found.');
        return json(response, 200, { backup: backupInfo(row), snapshot: row.snapshot });
      }
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
    response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : contents);
  }

  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    if (secureCookies) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    Promise.resolve().then(() => {
      const path = new URL(request.url, 'http://localhost').pathname;
      return path === '/api' || path.startsWith('/api/') ? handleApi(request, response, path) : serveStatic(request, response, path);
    }).catch(error => {
      if (response.destroyed || response.writableEnded) return;
      if (!(error instanceof HttpError)) console.error('Account request failed:', error.code ?? error.name);
      json(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'The server could not complete this request. Please try again.' });
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return {
    server,
    database,
    async close() {
      if (server.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      database.close();
    },
  };
}
