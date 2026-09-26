import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApplication } from './app.mjs';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'A long unique password 2026!';

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
  return { ...application, request, stop };
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
  // Independent email limits still hold across different real client addresses.
  assertError(await app.request('/api/auth/login', {
    method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.12' },
    body: { email: 'first@example.com', password: PASSWORD },
  }), 429);
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
