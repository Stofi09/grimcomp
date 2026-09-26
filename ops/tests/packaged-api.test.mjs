import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publisher = join(repo, 'ops/grimcomp-release.py');

function tool(args) {
  const result = spawnSync('python3', [publisher, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function makeWritable(path) {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await makeWritable(join(path, entry.name));
  }
}

test('the isolated packaged account API boots with SQLite and sets production cookies', { timeout: 15_000 }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'grimcomp-packaged-api-')));
  let application;
  try {
    const archive = join(base, 'api.tar.gz');
    const root = join(base, 'grimcomp-api');
    const sha = tool(['package', '--kind', 'api', '--source', join(repo, 'server'),
      '--output', archive, '--release', 'smoke', '--source-commit', 'a'.repeat(40)]);
    tool(['init', '--kind', 'api', '--root', root]);
    tool(['stage', '--kind', 'api', '--root', root, '--archive', archive, '--sha256', sha]);
    const deployed = join(root, 'releases/smoke');
    const { createApplication } = await import(pathToFileURL(join(deployed, 'server/app.mjs')).href);
    application = createApplication({ databasePath: join(base, 'private-state/grimcomp.sqlite'),
      allowedOrigins: ['https://grimcomp.solak.hu'], secureCookies: true,
      trustedProxies: ['127.0.0.1'], staticDir: join(base, 'no-static-site') });
    await new Promise((resolveListening, reject) => {
      application.server.once('error', reject);
      application.server.listen(0, '127.0.0.1', resolveListening);
    });
    const origin = `http://127.0.0.1:${application.server.address().port}`;
    assert.deepEqual(await (await fetch(`${origin}/api/health`)).json(), { ok: true });
    const response = await fetch(`${origin}/api/auth/register`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Grim-Client': 'web', Origin: 'https://grimcomp.solak.hu' },
      body: JSON.stringify({ name: 'Packaging smoke', email: 'packaging@example.invalid', password: 'temporary-test-password-123' }) });
    assert.equal(response.status, 201);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(response.headers.get('set-cookie'), /Secure/);
    assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
    assert.match(response.headers.get('set-cookie'), /Path=\/api/);
    const body = await response.json();
    assert.equal(body.user.email, 'packaging@example.invalid');
    assert.equal(body.token, undefined);
  } finally {
    if (application) await application.close();
    await makeWritable(base);
    await rm(base, { recursive: true, force: true });
  }
});
