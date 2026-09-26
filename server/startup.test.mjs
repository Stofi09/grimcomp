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

test('a busy port reports an actionable error and exits without an unhandled exception', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'grimcomp-startup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const occupied = createServer();
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const port = String(occupied.address().port);
  await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(new URL('./index.mjs', import.meta.url))], {
    timeout: 10_000,
    env: {
      ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: port,
      APP_ORIGINS: 'http://localhost:5173', TRUSTED_PROXIES: '',
      DATABASE_PATH: join(directory, 'account.sqlite'),
    },
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /already in use.*set PORT/);
    assert.doesNotMatch(error.stderr, /Unhandled|node:events|throw er/);
    return true;
  });
});
