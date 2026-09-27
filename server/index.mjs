import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApplication, REGISTRATION_MODES } from './app.mjs';

const production = process.env.NODE_ENV === 'production';

function positiveInteger(name, fallback) {
  const value = (process.env[name] ?? '').trim();
  if (!value) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive whole number.`);
  }
  return Number(value);
}
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const allowedOrigins = (process.env.APP_ORIGINS ?? (production ? '' :
  'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001,http://localhost:8081,http://localhost:8082'))
  .split(',').map(value => value.trim()).filter(Boolean);
if (!allowedOrigins.length) throw new Error('Set APP_ORIGINS to the public HTTPS origin of your app.');
for (const origin of allowedOrigins) {
  const url = new URL(origin);
  if (url.origin !== origin || (production ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))) {
    throw new Error('APP_ORIGINS must contain exact origins (HTTPS in production), without paths or trailing slashes.');
  }
}
// A public production server stays closed to sign-ups unless explicitly opened.
const registrationSetting = (process.env.REGISTRATION_MODE ?? '').trim();
const registrationMode = registrationSetting || (production ? 'closed' : 'open');
if (!REGISTRATION_MODES.includes(registrationMode)) {
  throw new Error(`REGISTRATION_MODE must be one of: ${REGISTRATION_MODES.join(', ')}.`);
}
const registrationInviteCode = (process.env.REGISTRATION_INVITE_CODE ?? '').trim();
if (registrationMode === 'invite' && (registrationInviteCode.length < 12 || registrationInviteCode.length > 256)) {
  throw new Error('REGISTRATION_MODE=invite needs REGISTRATION_INVITE_CODE with 12 to 256 characters.');
}
const maxAccounts = positiveInteger('MAX_ACCOUNTS', 1_000);
const maxBackupStorageBytes = positiveInteger('MAX_BACKUP_STORAGE_BYTES', 2 * 1024 ** 3);
process.umask(0o077);
const app = createApplication({
  databasePath: resolve(process.env.DATABASE_PATH ?? fileURLToPath(new URL('./data/grimcomp.sqlite', import.meta.url))),
  allowedOrigins,
  trustedProxies: (process.env.TRUSTED_PROXIES ?? '').split(',').map(value => value.trim()).filter(Boolean),
  secureCookies: production,
  registrationMode,
  registrationInviteCode: registrationMode === 'invite' ? registrationInviteCode : undefined,
  maxAccounts,
  maxBackupStorageBytes,
  staticDir: fileURLToPath(new URL('../web/dist', import.meta.url)),
});
// Never log the invite code itself.
console.log(`Account registration is ${registrationMode}${registrationSetting ? ''
  : ` (default for ${production ? 'production' : 'development'}; set REGISTRATION_MODE to change it)`}; `
  + `at most ${maxAccounts} accounts and ${maxBackupStorageBytes} bytes of stored backups.`);
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  try { await app.close(); }
  catch {
    console.error('Could not close the account server cleanly.');
    process.exitCode = 1;
  }
};
app.server.once('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? `Cannot start the account server: ${host}:${port} is already in use. Stop the other server or set PORT to a free port.`
    : `Cannot start the account server (${error.code ?? error.name}). Check HOST and PORT.`);
  process.exitCode = 1;
  void shutdown();
});
app.server.listen(port, host, () => console.log(`Grim Companion API listening on http://${host}:${port}`));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
