import assert from 'node:assert/strict';
import { randomBytes, randomUUID, scrypt, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { APP_CONTENT_SECURITY_POLICY, createApplication, MAX_BACKUP_BYTES, MAX_BACKUP_REQUEST_BYTES } from './app.mjs';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'A long unique password 2026!';
const NEW_PASSWORD = 'An entirely new passphrase 2026!';
const realDeriveKey = promisify(scrypt);

/** Wrap scrypt to count derivations; a gated wrapper holds each one until released. */
function trackedDeriveKey({ gated = false } = {}) {
  const calls = [];
  const gates = [];
  async function deriveKey(password, salt, keyBytes, options) {
    calls.push({ options });
    if (gated) await new Promise(resolve => gates.push(resolve));
    return realDeriveKey(password, salt, keyBytes, options);
  }
  return {
    deriveKey,
    calls,
    releaseNext: () => gates.shift()?.(),
    get held() { return gates.length; },
  };
}

async function waitUntil(condition, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.');
    await delay(5);
  }
}

function legacyHash(password, { N = 16_384, r = 8, p = 1 } = {}) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${N}$${r}$${p}$${salt}$${scryptSync(password, salt, 64, { N, r, p }).toString('hex')}`;
}

function insertUser(app, email, passwordHash) {
  const id = randomUUID();
  app.database.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, email, 'Legacy Adventurer', passwordHash, Date.now());
  return id;
}

const storedHash = (app, id) => app.database.prepare('SELECT password_hash FROM users WHERE id = ?').get(id).password_hash;
const countRows = (app, table) => app.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
const databaseWrites = (app) => app.database.prepare('SELECT total_changes() AS count').get().count;

async function start(t, options = {}) {
  const application = createApplication({
    databasePath: ':memory:',
    allowedOrigins: [ORIGIN],
    secureCookies: false,
    ...options,
  });
  const listening = once(application.server, 'listening');
  application.server.listen(0, '127.0.0.1');
  await listening;
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  let closed = false;
  async function stop() {
    if (closed) return;
    closed = true;
    await application.close();
  }
  t.after(stop);

  async function request(path, {
    method = 'GET', body, rawBody, token, cookie, origin, client = 'native', headers = {},
  } = {}) {
    const requestHeaders = new Headers(headers);
    if (client !== null) requestHeaders.set('X-Grim-Client', client);
    if (body !== undefined || rawBody !== undefined) requestHeaders.set('Content-Type', 'application/json');
    if (token !== undefined) requestHeaders.set('Authorization', `Bearer ${token}`);
    if (cookie !== undefined) requestHeaders.set('Cookie', cookie);
    if (origin !== undefined) requestHeaders.set('Origin', origin);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    let data = null;
    if (text) {
      assert.match(response.headers.get('content-type') ?? '', /application\/json/i);
      data = JSON.parse(text);
    }
    return { status: response.status, headers: response.headers, data, text };
  }
  return { ...application, baseUrl, request, stop };
}

async function register(app, values = {}, requestOptions = {}) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    body: { name: 'A New Adventurer', email: 'adventurer@example.com', password: PASSWORD, ...values },
    ...requestOptions,
  });
  assert.ok([200, 201].includes(response.status), JSON.stringify(response.data));
  return response;
}

function assertError(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  assert.equal(typeof response.data?.error, 'string');
  assert.ok(response.data.error.length > 0);
}

test('failed registration session writes roll back the account and preserve the prior session', async (t) => {
  const app = await start(t);
  const previous = await register(app);
  app.database.exec(`CREATE TEMP TRIGGER reject_sessions BEFORE INSERT ON sessions
    BEGIN SELECT RAISE(ABORT, 'simulated session storage failure'); END;`);
  const failed = await app.request('/api/auth/register', {
    method: 'POST', token: previous.data.token,
    body: { name: 'Second account', email: 'second@example.com', password: PASSWORD },
  });
  assertError(failed, 500);
  assert.equal(failed.headers.get('set-cookie'), null);
  assert.equal(app.database.prepare('SELECT id FROM users WHERE email = ?').get('second@example.com'), undefined);
  assert.equal((await app.request('/api/auth/session', { token: previous.data.token })).data.user.id, previous.data.user.id);
  app.database.exec('DROP TRIGGER reject_sessions');
  const retry = await register(app, { email: 'second@example.com' }, { token: previous.data.token });
  assert.notEqual(retry.data.user.id, previous.data.user.id);
  assert.equal((await app.request('/api/auth/session', { token: previous.data.token })).data.user, null);
});

test('failed login rotation preserves the previous cookie until a replacement is committed', async (t) => {
  const app = await start(t);
  const previous = await register(app, {}, { client: 'web', origin: ORIGIN });
  const cookie = previous.headers.get('set-cookie').split(';')[0];
  app.database.exec(`CREATE TEMP TRIGGER reject_sessions BEFORE INSERT ON sessions
    BEGIN SELECT RAISE(ABORT, 'simulated session storage failure'); END;`);
  const login = () => app.request('/api/auth/login', {
    method: 'POST', client: 'web', origin: ORIGIN, cookie,
    body: { email: previous.data.user.email, password: PASSWORD },
  });
  const failed = await login();
  assertError(failed, 500);
  assert.equal(failed.headers.get('set-cookie'), null);
  assert.equal((await app.request('/api/auth/session', { client: 'web', cookie })).data.user.id, previous.data.user.id);
  app.database.exec('DROP TRIGGER reject_sessions');
  const retry = await login();
  assert.equal(retry.status, 200);
  assert.notEqual(retry.headers.get('set-cookie').split(';')[0], cookie);
  assert.equal((await app.request('/api/auth/session', { client: 'web', cookie })).data.user, null);
});

test('untrusted callers cannot bypass IP rate limits by changing forwarded addresses', async (t) => {
  const app = await start(t, { rateLimit: 1 });
  await register(app, {}, { headers: { 'X-Forwarded-For': '198.51.100.10' } });
  assertError(await app.request('/api/auth/register', {
    method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.11' },
    body: { email: 'another@example.com', password: PASSWORD },
  }), 429);
});

test('trusted proxies keep client rate limits separate and ignore spoofed leftmost addresses', async (t) => {
  const app = await start(t, { rateLimit: 1, trustedProxies: ['127.0.0.1'] });
  await register(app, { email: 'first@example.com' }, { headers: { 'X-Forwarded-For': '198.51.100.10' } });
  await register(app, { email: 'second@example.com' }, { headers: { 'X-Forwarded-For': '198.51.100.11' } });
  assertError(await app.request('/api/auth/register', {
    method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.99, 198.51.100.10' },
    body: { email: 'third@example.com', password: PASSWORD },
  }), 429);
  // Attempts from other networks never lock the owner out of a fresh network.
  const login = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.12' },
    body: { email: 'first@example.com', password: PASSWORD },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
});

test('over-limit sign-in attempts are refused before hashing or any database write', async (t) => {
  const hashing = trackedDeriveKey();
  const app = await start(t, { rateLimit: 1, deriveKey: hashing.deriveKey });
  assertError(await app.request('/api/auth/login', {
    method: 'POST', body: { email: 'missing@example.com', password: PASSWORD },
  }), 401);
  assert.equal(hashing.calls.length, 1);
  const writes = databaseWrites(app);
  for (const path of ['/api/auth/login', '/api/auth/register']) {
    const refused = await app.request(path, {
      method: 'POST', body: { name: 'Adventurer', email: 'another@example.com', password: PASSWORD },
    });
    assertError(refused, 429);
    assert.ok(Number(refused.headers.get('retry-after')) >= 1);
  }
  assert.equal(hashing.calls.length, 1);
  assert.equal(databaseWrites(app), writes);
  assert.equal(countRows(app, 'rate_limits'), 0);
});

test('IPv6 clients share one rate-limit bucket per /64 network', async (t) => {
  const app = await start(t, { rateLimit: 1, trustedProxies: ['127.0.0.1'] });
  const attempt = forwardedFor => app.request('/api/auth/login', {
    method: 'POST', headers: { 'X-Forwarded-For': forwardedFor },
    body: { email: 'missing@example.com', password: PASSWORD },
  });
  assertError(await attempt('2001:db8:1:2::1'), 401);
  assertError(await attempt('2001:db8:1:2:ffff:ffff:ffff:ffff'), 429);
  assertError(await attempt('2001:db8:1:3::1'), 401);
});

test('only failed sign-ins count per account and network, so the owner is never locked out elsewhere', async (t) => {
  const app = await start(t, { failedLoginLimit: 2, trustedProxies: ['127.0.0.1'] });
  await register(app);
  const login = (password, forwardedFor = '198.51.100.20', email = 'adventurer@example.com') => app.request('/api/auth/login', {
    method: 'POST', headers: { 'X-Forwarded-For': forwardedFor }, body: { email, password },
  });
  for (let index = 0; index < 3; index += 1) assert.equal((await login(PASSWORD)).status, 200);
  assertError(await login('A wrong password guess'), 401);
  assertError(await login('Another wrong password guess'), 401);
  const locked = await login(PASSWORD);
  assertError(locked, 429);
  assert.ok(Number(locked.headers.get('retry-after')) >= 1);
  // The same account elsewhere, and other accounts on this network, are unaffected.
  assert.equal((await login(PASSWORD, '198.51.100.21')).status, 200);
  assertError(await login(PASSWORD, '198.51.100.20', 'someone-else@example.com'), 401);
  // A successful sign-in clears that network's failures for the account.
  assertError(await login('A wrong password guess', '198.51.100.22'), 401);
  assert.equal((await login(PASSWORD, '198.51.100.22')).status, 200);
  assertError(await login('A wrong password guess', '198.51.100.22'), 401);
  assertError(await login('Another wrong password guess', '198.51.100.22'), 401);
  assertError(await login(PASSWORD, '198.51.100.22'), 429);
});

test('sign-in uses the stored scrypt parameters and upgrades outdated hashes', async (t) => {
  const app = await start(t);
  const id = insertUser(app, 'legacy@example.com', legacyHash(PASSWORD));
  const login = password => app.request('/api/auth/login', { method: 'POST', body: { email: 'legacy@example.com', password } });
  assertError(await login('Not the right password at all'), 401);
  assert.match(storedHash(app, id), /^scrypt\$16384\$8\$1\$/);
  assert.equal((await login(PASSWORD)).status, 200);
  const upgraded = storedHash(app, id);
  assert.match(upgraded, /^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal((await login(PASSWORD)).status, 200);
  assert.equal(storedHash(app, id), upgraded);
  assertError(await login('Not the right password at all'), 401);
});

test('malformed or out-of-bounds stored hashes fail sign-in with 401, never 500', async (t) => {
  const app = await start(t);
  const valid = legacyHash(PASSWORD).split('$');
  const variants = [
    '', 'not-a-hash', 'bcrypt$2b$12$abcdefghijklmnopqrstuv', valid.slice(0, 4).join('$'),
    [...valid, 'extra'].join('$'),
    ['scrypt', '16000', ...valid.slice(2)].join('$'),
    ['scrypt', String(2 ** 24), ...valid.slice(2)].join('$'),
    ['scrypt', '65536', '16', '1', ...valid.slice(4)].join('$'),
    ['scrypt', '16384', '8', '99', ...valid.slice(4)].join('$'),
    ['scrypt', '016384', ...valid.slice(2)].join('$'),
    [...valid.slice(0, 4), 'zz'.repeat(16), valid[5]].join('$'),
    [...valid.slice(0, 5), valid[5].slice(0, 127)].join('$'),
  ];
  for (const [index, passwordHash] of variants.entries()) {
    insertUser(app, `broken${index}@example.com`, passwordHash);
    assertError(await app.request('/api/auth/login', {
      method: 'POST', body: { email: `broken${index}@example.com`, password: PASSWORD },
    }), 401);
  }
});

function snapshot(time = '2026-09-12T10:00:00.000Z') {
  return JSON.stringify({ $schema: 'grimcomp.v1', scope: 'roster', exportedAt: time, 'gc.notes': [] });
}

async function saveBackup(app, token, value = snapshot()) {
  const response = await app.request('/api/backups', { method: 'POST', token, body: { snapshot: value } });
  assert.ok([200, 201].includes(response.status), JSON.stringify(response.data));
  assert.equal(typeof response.data.backup.id, 'string');
  assert.equal(response.data.backup.bytes, Buffer.byteLength(value, 'utf8'));
  assert.ok(Number.isFinite(Date.parse(response.data.backup.createdAt)));
  return response.data.backup;
}

test('registration normalizes email, hashes passwords, and exposes only public user fields', async (t) => {
  const app = await start(t);
  const registered = await register(app, { email: '  Adventurer@Example.COM  ' });
  const { user, token, expiresAt } = registered.data;
  assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'name']);
  assert.equal(user.email, 'adventurer@example.com');
  assert.equal(user.name, 'A New Adventurer');
  assert.equal(typeof user.id, 'string');
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 32);
  assert.ok(Date.parse(expiresAt) > Date.now());
  assert.equal(registered.headers.get('cache-control'), 'no-store');

  const stored = app.database.prepare('SELECT email, password_hash FROM users WHERE id = ?').get(user.id);
  assert.equal(stored.email, user.email);
  assert.equal(typeof stored.password_hash, 'string');
  assert.notEqual(stored.password_hash, PASSWORD);
  assert.ok(!stored.password_hash.includes(PASSWORD));
  assert.ok(!registered.text.includes(stored.password_hash));

  const duplicate = await app.request('/api/auth/register', {
    method: 'POST', body: { name: 'Another Name', email: 'ADVENTURER@example.com', password: PASSWORD },
  });
  assertError(duplicate, 409);
  const login = await app.request('/api/auth/login', {
    method: 'POST', body: { email: '  ADVENTURER@EXAMPLE.COM ', password: PASSWORD },
  });
  assert.equal(login.status, 200);
  assert.deepEqual(login.data.user, user);
  assert.notEqual(login.data.token, token);
});

test('accounts, sessions, and snapshots survive closing and reopening the database', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'grimcomp-auth-'));
  const databasePath = join(directory, 'grimcomp.sqlite');
  const first = await start(t, { databasePath });
  const registered = await register(first);
  const value = snapshot();
  const backup = await saveBackup(first, registered.data.token, value);
  await first.stop();

  const reopened = await start(t, { databasePath });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = await reopened.request('/api/auth/session', { token: registered.data.token });
  assert.equal(session.status, 200);
  assert.deepEqual(session.data.user, registered.data.user);
  const login = await reopened.request('/api/auth/login', {
    method: 'POST', body: { email: 'adventurer@example.com', password: PASSWORD },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, registered.data.user.id);
  const saved = await reopened.request(`/api/backups/${backup.id}`, { token: login.data.token });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data, { backup, snapshot: value });
});

test('wrong passwords and unknown accounts produce the same generic login error', async (t) => {
  const app = await start(t);
  await register(app);
  const wrongPassword = await app.request('/api/auth/login', {
    method: 'POST', body: { email: 'adventurer@example.com', password: 'A different long password!' },
  });
  const unknownAccount = await app.request('/api/auth/login', {
    method: 'POST', body: { email: 'missing@example.com', password: PASSWORD },
  });
  assertError(wrongPassword, 401);
  assertError(unknownAccount, 401);
  assert.deepEqual(wrongPassword.data, unknownAccount.data);
  assert.equal(wrongPassword.headers.get('set-cookie'), null);
});

test('registration rejects invalid fields and malformed request bodies', async (t) => {
  const app = await start(t);
  for (const invalid of [
    { name: '' },
    { email: 'not-an-email' },
    { password: 'short' },
    { password: 'x'.repeat(129) },
    { password: null },
  ]) {
    assertError(await app.request('/api/auth/register', {
      method: 'POST', body: { name: 'Adventurer', email: 'valid@example.com', password: PASSWORD, ...invalid },
    }), 400);
  }
  for (const rawBody of ['{', 'null', '[]']) {
    assertError(await app.request('/api/auth/register', { method: 'POST', rawBody }), 400);
  }
  assert.equal(app.database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});

test('anonymous and invalid sessions cannot access backups', async (t) => {
  const app = await start(t);
  for (const token of [undefined, 'invalid-session-token']) {
    const session = await app.request('/api/auth/session', { token });
    assert.equal(session.status, 200);
    assert.deepEqual(session.data, { user: null });
    assertError(await app.request('/api/backups', { token }), 401);
    assertError(await app.request('/api/backups', { method: 'POST', token, body: { snapshot: snapshot() } }), 401);
    assertError(await app.request('/api/backups/nonexistent', { token }), 401);
  }
});

test('logout revokes only the current session and rejects subsequent authenticated writes', async (t) => {
  const app = await start(t);
  const registered = await register(app);
  const login = await app.request('/api/auth/login', {
    method: 'POST', body: { email: 'adventurer@example.com', password: PASSWORD },
  });
  assert.equal(login.status, 200);
  const logout = await app.request('/api/auth/logout', { method: 'POST', token: registered.data.token, body: {} });
  assert.equal(logout.status, 204);
  assert.equal(logout.text, '');
  const revoked = await app.request('/api/auth/session', { token: registered.data.token });
  assert.deepEqual(revoked.data, { user: null });
  assertError(await app.request('/api/backups', {
    method: 'POST', token: registered.data.token, body: { snapshot: snapshot() },
  }), 401);
  const otherSession = await app.request('/api/auth/session', { token: login.data.token });
  assert.deepEqual(otherSession.data.user, registered.data.user);
});

test('expired sessions lose access even when the bearer token is otherwise valid', async (t) => {
  let currentTime = Date.parse('2026-09-12T10:00:00.000Z');
  const app = await start(t, { now: () => currentTime });
  const registered = await register(app);
  currentTime = Date.parse(registered.data.expiresAt) + 1;
  const session = await app.request('/api/auth/session', { token: registered.data.token });
  assert.equal(session.status, 200);
  assert.deepEqual(session.data, { user: null });
  assertError(await app.request('/api/backups', { token: registered.data.token }), 401);
  const renewed = await app.request('/api/auth/login', {
    method: 'POST', body: { email: 'adventurer@example.com', password: PASSWORD },
  });
  assert.equal(renewed.status, 200);
  assert.ok(Date.parse(renewed.data.expiresAt) > currentTime);
});

test('web authentication keeps tokens in HttpOnly cookies and clears them on logout', async (t) => {
  const app = await start(t, { secureCookies: true });
  const registered = await register(app, {}, { client: 'web', origin: ORIGIN });
  assert.equal(registered.data.token, undefined);
  const setCookie = registered.headers.get('set-cookie');
  assert.ok(setCookie);
  assert.match(setCookie, /;\s*HttpOnly(?:;|$)/i);
  assert.match(setCookie, /;\s*SameSite=Lax(?:;|$)/i);
  assert.match(setCookie, /;\s*Secure(?:;|$)/i);
  assert.match(setCookie, /;\s*Path=\/api(?:;|$)/i);
  const cookie = setCookie.split(';')[0];
  const cookieToken = cookie.slice(cookie.indexOf('=') + 1);
  assert.ok(cookieToken.length >= 32);
  assert.ok(!registered.text.includes(cookieToken));
  const session = await app.request('/api/auth/session', { client: 'web', cookie, origin: ORIGIN });
  assert.equal(session.status, 200);
  assert.deepEqual(session.data.user, registered.data.user);
  assert.ok(!session.text.includes(cookieToken));
  assert.equal(session.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(session.headers.get('access-control-allow-credentials'), 'true');

  const logout = await app.request('/api/auth/logout', {
    method: 'POST', client: 'web', origin: ORIGIN, cookie, body: {},
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie') ?? '', /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  const staleCookie = await app.request('/api/auth/session', { client: 'web', cookie, origin: ORIGIN });
  assert.deepEqual(staleCookie.data, { user: null });

  const login = await app.request('/api/auth/login', {
    method: 'POST', client: 'web', origin: ORIGIN,
    body: { email: 'adventurer@example.com', password: PASSWORD },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.token, undefined);
  assert.match(login.headers.get('set-cookie') ?? '', /HttpOnly/i);
});

test('web mutations require an allowed Origin and native headers cannot bypass an untrusted Origin', async (t) => {
  const app = await start(t);
  for (const origin of [undefined, 'https://attacker.example', 'null']) {
    const response = await app.request('/api/auth/register', {
      method: 'POST', client: 'web', origin,
      body: { name: 'Adventurer', email: 'csrf@example.com', password: PASSWORD },
    });
    assertError(response, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const registered = await register(app, {}, { client: 'web', origin: ORIGIN });
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  for (const client of ['web', 'native', null]) {
    assertError(await app.request('/api/backups', {
      method: 'POST', client, cookie, origin: 'https://attacker.example', body: { snapshot: snapshot() },
    }), 403);
    assertError(await app.request('/api/auth/logout', {
      method: 'POST', client, cookie, origin: 'https://attacker.example', body: {},
    }), 403);
  }
  const session = await app.request('/api/auth/session', { client: 'web', cookie, origin: ORIGIN });
  assert.deepEqual(session.data.user, registered.data.user);
  const backups = await app.request('/api/backups', { client: 'web', cookie, origin: ORIGIN });
  assert.deepEqual(backups.data, { backups: [] });
});

test('backups are isolated by account and round-trip their exact snapshot contents', async (t) => {
  const app = await start(t);
  const alice = (await register(app, { email: 'alice@example.com' })).data;
  const bob = (await register(app, { email: 'bob@example.com' })).data;
  const value = snapshot();
  const backup = await saveBackup(app, alice.token, value);
  const list = await app.request('/api/backups', { token: alice.token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.data, { backups: [backup] });
  assert.equal(list.data.backups[0].snapshot, undefined);
  const restored = await app.request(`/api/backups/${backup.id}`, { token: alice.token });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.data, { backup, snapshot: value });
  const bobsList = await app.request('/api/backups', { token: bob.token });
  assert.deepEqual(bobsList.data, { backups: [] });
  assertError(await app.request(`/api/backups/${backup.id}`, { token: bob.token }), 404);
  assertError(await app.request('/api/backups/nonexistent', { token: alice.token }), 404);
});

for (const client of ['native', 'web']) {
  test(`${client} backup requests reject stale account identity after the session changes`, async (t) => {
    const app = await start(t);
    const clientOptions = { client, ...(client === 'web' ? { origin: ORIGIN } : {}) };
    const authOptions = response => ({
      ...clientOptions,
      ...(client === 'web'
        ? { cookie: response.headers.get('set-cookie').split(';')[0] }
        : { token: response.data.token }),
    });
    const alice = await register(app, { email: 'alice@example.com' }, clientOptions);
    const aliceRequest = {
      ...authOptions(alice), headers: { 'X-Grim-User': alice.data.user.id },
    };
    const alicesBackup = await app.request('/api/backups', {
      ...aliceRequest, method: 'POST', body: { snapshot: snapshot() },
    });
    assert.equal(alicesBackup.status, 201);

    // A different tab/client switches the shared session while the old UI still displays Alice.
    const bob = await register(app, { email: 'bob@example.com' }, authOptions(alice));
    const bobRequest = { ...authOptions(bob), headers: { 'X-Grim-User': bob.data.user.id } };
    const bobsBackup = await app.request('/api/backups', {
      ...bobRequest, method: 'POST', body: { snapshot: snapshot('2026-09-12T11:00:00.000Z') },
    });
    assert.equal(bobsBackup.status, 201);
    const staleRequest = { ...authOptions(bob), headers: { 'X-Grim-User': alice.data.user.id } };
    assertError(await app.request('/api/backups', staleRequest), 409);
    assertError(await app.request('/api/backups', {
      ...staleRequest, method: 'POST', body: { snapshot: snapshot('2026-09-12T12:00:00.000Z') },
    }), 409);
    assertError(await app.request(`/api/backups/${bobsBackup.data.backup.id}`, staleRequest), 409);

    const bobsList = await app.request('/api/backups', bobRequest);
    assert.equal(bobsList.status, 200);
    assert.deepEqual(bobsList.data.backups, [bobsBackup.data.backup]);
    const restored = await app.request(`/api/backups/${bobsBackup.data.backup.id}`, bobRequest);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.snapshot, snapshot('2026-09-12T11:00:00.000Z'));
    const alicesRow = app.database.prepare('SELECT snapshot FROM backups WHERE id = ? AND user_id = ?')
      .get(alicesBackup.data.backup.id, alice.data.user.id);
    assert.equal(alicesRow.snapshot, snapshot());
  });
}

test('invalid and oversized snapshots cannot replace or remove a valid saved backup', async (t) => {
  const app = await start(t);
  const { token } = (await register(app)).data;
  const backup = await saveBackup(app, token);
  const valid = JSON.parse(snapshot());
  for (const value of [
    '{',
    'null',
    '[]',
    JSON.stringify({ ...valid, $schema: 'unknown.v1' }),
    JSON.stringify({ ...valid, scope: 'unknown' }),
    JSON.stringify({ $schema: 'grimcomp.v1', scope: 'roster', exportedAt: valid.exportedAt }),
  ]) {
    assertError(await app.request('/api/backups', { method: 'POST', token, body: { snapshot: value } }), 400);
  }
  assertError(await app.request('/api/backups', { method: 'POST', token, body: { snapshot: valid } }), 400);
  const tooLarge = snapshot() + ' '.repeat(960 * 1024);
  assertError(await app.request('/api/backups', { method: 'POST', token, body: { snapshot: tooLarge } }), 413);
  const list = await app.request('/api/backups', { token });
  assert.deepEqual(list.data, { backups: [backup] });
  const restored = await app.request(`/api/backups/${backup.id}`, { token });
  assert.equal(restored.data.snapshot, snapshot());
});

/** Start a native backup upload whose body arrives only when `finish` is called. */
function startUpload(app, token, value = snapshot()) {
  const body = JSON.stringify({ snapshot: value });
  const received = once(app.server, 'request');
  const upload = httpRequest(`${app.baseUrl}/api/backups`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      'X-Grim-Client': 'native', Authorization: `Bearer ${token}`,
    },
  });
  const response = new Promise((resolveResponse, reject) => {
    upload.on('response', incoming => {
      let text = '';
      incoming.setEncoding('utf8');
      incoming.on('data', chunk => { text += chunk; });
      incoming.on('end', () => resolveResponse({ status: incoming.statusCode, data: text ? JSON.parse(text) : null }));
    });
    upload.on('error', reject);
  });
  upload.write(body.slice(0, 1));
  return {
    // The application handler runs before this resolves, so its slot is taken.
    started: received.then(([serverRequest]) => serverRequest),
    finish() {
      upload.end(body.slice(1));
      return response;
    },
    abort() {
      response.catch(() => {});
      upload.destroy();
    },
  };
}

test('backup bodies are capped at twice the snapshot limit, which still fits an honest maximal snapshot', async (t) => {
  const app = await start(t);
  const { token } = (await register(app)).data;
  const prefix = '{"$schema":"grimcomp.v1","scope":"roster","gc.notes":"';
  const suffix = '"}';
  const room = MAX_BACKUP_BYTES - prefix.length - suffix.length;
  // Escaped quotes are the worst case: they double again in the request body.
  const worstCase = `${prefix}${'\\"'.repeat(Math.floor(room / 2))}${'x'.repeat(room % 2)}${suffix}`;
  assert.equal(Buffer.byteLength(worstCase), MAX_BACKUP_BYTES);
  const body = Buffer.byteLength(JSON.stringify({ snapshot: worstCase }));
  assert.ok(body > 1.99 * MAX_BACKUP_BYTES && body <= MAX_BACKUP_REQUEST_BYTES, String(body));
  await saveBackup(app, token, worstCase);
  // Padding that the old six-fold limit accepted is now refused before parsing.
  const padded = `{"snapshot":${JSON.stringify(snapshot())}${' '.repeat(MAX_BACKUP_REQUEST_BYTES)}}`;
  assert.ok(Buffer.byteLength(padded) < 6 * MAX_BACKUP_BYTES);
  assertError(await app.request('/api/backups', { method: 'POST', token, rawBody: padded }), 413);
  assert.equal((await app.request('/api/backups', { token })).data.backups.length, 1);
});

test('backup uploads in flight are bounded per account and globally before their bodies are read', async (t) => {
  const app = await start(t, { maxConcurrentUploads: 1 });
  const alice = (await register(app, { email: 'alice@example.com' })).data;
  const bob = (await register(app, { email: 'bob@example.com' })).data;
  const first = startUpload(app, alice.token);
  await first.started;
  const again = await app.request('/api/backups', { method: 'POST', token: alice.token, body: { snapshot: snapshot() } });
  assertError(again, 429);
  assert.ok(Number(again.headers.get('retry-after')) >= 1);
  const busy = await app.request('/api/backups', { method: 'POST', token: bob.token, body: { snapshot: snapshot() } });
  assertError(busy, 503);
  assert.ok(Number(busy.headers.get('retry-after')) >= 1);
  assert.equal((await first.finish()).status, 201);
  await saveBackup(app, bob.token);

  // An abandoned upload gives its slots back as soon as its connection closes.
  const abandoned = startUpload(app, alice.token);
  const serverRequest = await abandoned.started;
  // A plain listener: events.once() would also subscribe to 'error'.
  const closed = new Promise(resolveClose => serverRequest.once('close', resolveClose));
  abandoned.abort();
  await closed;
  await new Promise(resolveTick => setImmediate(resolveTick));
  await saveBackup(app, alice.token, snapshot('2026-09-12T11:00:00.000Z'));
  assert.equal((await app.request('/api/backups', { token: alice.token })).data.backups.length, 2);
});

test('closed registration refuses new accounts while existing accounts can still sign in', async (t) => {
  const app = await start(t, { registrationMode: 'closed' });
  insertUser(app, 'owner@example.com', legacyHash(PASSWORD));
  assert.deepEqual((await app.request('/api/auth/registration')).data, { mode: 'closed' });
  const refused = await app.request('/api/auth/register', {
    method: 'POST', body: { name: 'Adventurer', email: 'new@example.com', password: PASSWORD },
  });
  assertError(refused, 403);
  assert.equal(refused.data.code, 'registration_closed');
  assert.equal(countRows(app, 'users'), 1);
  const login = await app.request('/api/auth/login', { method: 'POST', body: { email: 'owner@example.com', password: PASSWORD } });
  assert.equal(login.status, 200);
});

test('invite registration accepts only the configured invite code', async (t) => {
  const inviteCode = 'friends-of-the-grim-2026';
  const app = await start(t, { registrationMode: 'invite', registrationInviteCode: inviteCode });
  assert.deepEqual((await app.request('/api/auth/registration')).data, { mode: 'invite' });
  for (const offered of [undefined, '', 'friends-of-the-grim-2025', `${inviteCode}x`, 42]) {
    const refused = await app.request('/api/auth/register', {
      method: 'POST', body: { name: 'Adventurer', email: 'new@example.com', password: PASSWORD, inviteCode: offered },
    });
    assertError(refused, 403);
    assert.equal(refused.data.code, 'invite_required');
  }
  assert.equal(countRows(app, 'users'), 0);
  assert.equal((await register(app, { email: 'new@example.com', inviteCode: ` ${inviteCode} ` })).status, 201);
});

test('invalid registration and capacity settings fail when the application is created', () => {
  assert.throws(() => createApplication({ registrationMode: 'public' }), /registrationMode must be one of/);
  assert.throws(() => createApplication({ registrationMode: 'invite' }), /invite code/);
  assert.throws(() => createApplication({ registrationMode: 'invite', registrationInviteCode: 'too-short' }), /invite code/);
  assert.throws(() => createApplication({ maxAccounts: 0 }), /maxAccounts/);
  assert.throws(() => createApplication({ maxBackupStorageBytes: 1.5 }), /maxBackupStorageBytes/);
});

test('the account limit refuses registration with a clear error before hashing', async (t) => {
  const hashing = trackedDeriveKey();
  const app = await start(t, { maxAccounts: 1, deriveKey: hashing.deriveKey });
  await register(app, { email: 'first@example.com' });
  const hashes = hashing.calls.length;
  const refused = await app.request('/api/auth/register', {
    method: 'POST', body: { name: 'Second', email: 'second@example.com', password: PASSWORD },
  });
  assertError(refused, 403);
  assert.equal(refused.data.code, 'account_limit');
  assert.match(refused.data.error, /account limit/);
  assert.equal(hashing.calls.length, hashes);
  assert.equal(countRows(app, 'users'), 1);
});

test('the backup storage ceiling refuses uploads that would exceed it after retention', async (t) => {
  const size = Buffer.byteLength(snapshot());
  let currentTime = Date.parse('2026-09-12T10:00:00.000Z');
  const app = await start(t, { maxBackupStorageBytes: 10 * size, now: () => currentTime });
  const alice = (await register(app, { email: 'alice@example.com' })).data;
  const bob = (await register(app, { email: 'bob@example.com' })).data;
  // The eleventh upload replaces Alice's oldest backup, so it stays within the ceiling.
  for (let index = 0; index < 11; index += 1) {
    currentTime += 1_000;
    await saveBackup(app, alice.token, snapshot(new Date(currentTime).toISOString()));
  }
  const full = await app.request('/api/backups', { method: 'POST', token: bob.token, body: { snapshot: snapshot() } });
  assertError(full, 507);
  assert.equal(full.data.code, 'storage_full');
  assert.deepEqual((await app.request('/api/backups', { token: bob.token })).data, { backups: [] });
  const oldest = (await app.request('/api/backups', { token: alice.token })).data.backups.at(-1);
  assert.equal((await app.request(`/api/backups/${oldest.id}`, { method: 'DELETE', token: alice.token })).status, 204);
  await saveBackup(app, bob.token);
});

test('health checks probe the database and answer 503 when it is unavailable', async (t) => {
  const app = await start(t);
  const healthy = await app.request('/api/health', { client: null });
  assert.equal(healthy.status, 200);
  assert.deepEqual(healthy.data, { ok: true });
  const logged = t.mock.method(console, 'error', () => {});
  app.database.close();
  const failing = await app.request('/api/health', { client: null });
  assert.equal(failing.status, 503);
  assert.equal(failing.data.ok, false);
  assert.equal(logged.mock.callCount(), 1);
});

test('only the newest ten backups are retained, separately for each account', async (t) => {
  let currentTime = Date.parse('2026-09-12T10:00:00.000Z');
  const app = await start(t, { now: () => currentTime });
  const alice = (await register(app, { email: 'alice@example.com' })).data;
  const bob = (await register(app, { email: 'bob@example.com' })).data;
  const bobsBackup = await saveBackup(app, bob.token);
  const saved = [];
  for (let index = 0; index < 12; index += 1) {
    currentTime += 1_000;
    saved.push(await saveBackup(app, alice.token, snapshot(new Date(currentTime).toISOString())));
  }
  const list = await app.request('/api/backups', { token: alice.token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.backups, saved.slice(-10).reverse());
  for (const removed of saved.slice(0, 2)) {
    assertError(await app.request(`/api/backups/${removed.id}`, { token: alice.token }), 404);
  }
  const bobsList = await app.request('/api/backups', { token: bob.token });
  assert.deepEqual(bobsList.data.backups, [bobsBackup]);
});

test('authentication attempts are rate limited and recover after the configured window', async (t) => {
  let currentTime = Date.parse('2026-09-12T10:00:00.000Z');
  const app = await start(t, { now: () => currentTime, rateLimit: 2, rateWindowMs: 1_000 });
  const requestLogin = () => app.request('/api/auth/login', {
    method: 'POST', body: { email: 'missing@example.com', password: PASSWORD },
  });
  assertError(await requestLogin(), 401);
  assertError(await requestLogin(), 401);
  assertError(await requestLogin(), 429);
  currentTime += 1_001;
  assertError(await requestLogin(), 401);
});

test('static hosting blocks encoded hidden files and rejects malformed URL encoding', async (t) => {
  const staticDir = await mkdtemp(join(tmpdir(), 'grimcomp-static-'));
  await mkdir(join(staticDir, '.hidden'));
  await Promise.all([
    writeFile(join(staticDir, '.env'), 'PRIVATE_VALUE=must-not-be-served'),
    writeFile(join(staticDir, '.hidden', 'config.json'), JSON.stringify({ secret: 'private-setting' })),
    writeFile(join(staticDir, 'public.json'), JSON.stringify({ public: true })),
  ]);
  const app = await start(t, { staticDir });
  t.after(() => rm(staticDir, { recursive: true, force: true }));
  const publicFile = await app.request('/public.json');
  assert.equal(publicFile.status, 200);
  assert.deepEqual(publicFile.data, { public: true });
  for (const path of ['/.env', '/%2eenv', '/%2Eenv', '/%2ehidden/config.json', '/%2Ehidden%2fconfig.json']) {
    const response = await app.request(path);
    assertError(response, 404);
    assert.ok(!response.text.includes('must-not-be-served'));
    assert.ok(!response.text.includes('private-setting'));
  }
  for (const path of ['/%', '/%GG', '/%E0%A4%A']) {
    assertError(await app.request(path), 400);
  }
});
