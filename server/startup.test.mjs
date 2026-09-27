import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverEntry = fileURLToPath(new URL('./index.mjs', import.meta.url));

/** Occupy a port so the server exits right after start-up configuration. */
async function busyPort(t) {
  const directory = await mkdtemp(join(tmpdir(), 'grimcomp-startup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const occupied = createServer();
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  return {
    PORT: String(occupied.address().port), HOST: '127.0.0.1', TRUSTED_PROXIES: '',
    REGISTRATION_MODE: '', REGISTRATION_INVITE_CODE: '', MAX_ACCOUNTS: '', MAX_BACKUP_STORAGE_BYTES: '',
    DATABASE_PATH: join(directory, 'account.sqlite'),
  };
}

const runServer = env => promisify(execFile)(process.execPath, [serverEntry], { timeout: 10_000, env: { ...process.env, ...env } });

test('a busy port reports an actionable error and exits without an unhandled exception', async (t) => {
  await assert.rejects(runServer({
    ...await busyPort(t), NODE_ENV: 'development', APP_ORIGINS: 'http://localhost:5173',
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /already in use.*set PORT/);
    assert.doesNotMatch(error.stderr, /Unhandled|node:events|throw er/);
    assert.match(error.stdout, /registration is open \(default for development/);
    return true;
  });
});

test('production closes registration unless REGISTRATION_MODE opens it, and logs the effective mode', async (t) => {
  const production = { NODE_ENV: 'production', APP_ORIGINS: 'https://grimcomp.example' };
  await assert.rejects(runServer({ ...await busyPort(t), ...production }), error => {
    assert.match(error.stdout, /registration is closed \(default for production; set REGISTRATION_MODE/);
    assert.match(error.stdout, /at most 1000 accounts and 2147483648 bytes/);
    return true;
  });
  const inviteCode = 'a-private-invite-code-2026';
  await assert.rejects(runServer({
    ...await busyPort(t), ...production, REGISTRATION_MODE: 'invite', REGISTRATION_INVITE_CODE: inviteCode,
    MAX_ACCOUNTS: '25', MAX_BACKUP_STORAGE_BYTES: '1048576',
  }), error => {
    assert.match(error.stdout, /registration is invite; at most 25 accounts and 1048576 bytes/);
    assert.doesNotMatch(error.stdout + error.stderr, new RegExp(inviteCode));
    return true;
  });
});

test('invalid registration and capacity settings stop start-up with a clear message', async (t) => {
  for (const [settings, message] of [
    [{ REGISTRATION_MODE: 'public' }, /REGISTRATION_MODE must be one of: open, closed, invite/],
    [{ REGISTRATION_MODE: 'invite' }, /REGISTRATION_INVITE_CODE with 12 to 256 characters/],
    [{ MAX_ACCOUNTS: '0' }, /MAX_ACCOUNTS must be a positive whole number/],
    [{ MAX_BACKUP_STORAGE_BYTES: '2GiB' }, /MAX_BACKUP_STORAGE_BYTES must be a positive whole number/],
  ]) {
    await assert.rejects(runServer({
      ...await busyPort(t), NODE_ENV: 'development', APP_ORIGINS: 'http://localhost:5173', ...settings,
    }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, message);
      return true;
    });
  }
});
