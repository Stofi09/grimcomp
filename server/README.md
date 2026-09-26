# Accounts and database

Grim Companion has an optional account service for the Expo and Vite apps. Open
**Settings → Account & backups** (web: **Account & private backups**) to create an
account, sign in, sign out, save a roster backup, or restore an earlier backup.

Gameplay continues to use the existing offline storage. Account changes leave
the device roster in place. Backups belong to the authenticated account; upload
and restore are explicit actions. The newest ten backups per account are kept.
Restoring merges custom characters, replaces matching saved values, and retains
other local data. Each platform validates and durably imports the backup using
its existing import pipeline. Some web content packs are incompatible with the
native catalogue and will be rejected by native validation.

## Development

Use **Node.js 24 LTS** and the repository's pnpm version. The backend uses
[Node's built-in SQLite driver](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
and requires no database service or additional backend packages.

```sh
# From the repository root:
pnpm install
cp .env.example .env
pnpm server

# In another terminal for the browser app:
pnpm --dir web dev

# Or launch Expo using the existing simulator scripts:
pnpm start
```

The backend listens on `127.0.0.1:3001` by default. Vite forwards `/api` requests
to it. The first start creates `server/data/grimcomp.sqlite` and atomically
applies `migrations/001_accounts.sql`. Server watch mode is `pnpm server:watch`.
Do not run multiple independent database copies behind a load balancer.

For a physical phone/tablet, set `HOST=0.0.0.0` and set
`EXPO_PUBLIC_API_URL=http://<computer-LAN-IP>:3001` before restarting Metro.
Android emulators normally reach the host at `http://10.0.2.2:3001`; the iOS
simulator uses `http://localhost:3001`. HTTP is accepted by the native client only
in a development build. Expo web origins must be listed in `APP_ORIGINS`.

## Configuration and hosting

| Variable | Meaning |
| --- | --- |
| `DATABASE_PATH` | SQLite file path; default `server/data/grimcomp.sqlite`. |
| `HOST`, `PORT` | Listening address and port; default `127.0.0.1:3001`. |
| `APP_ORIGINS` | Comma-separated exact browser origins, without trailing slashes. |
| `TRUSTED_PROXIES` | Optional comma-separated exact proxy IP addresses; empty by default. |
| `NODE_ENV=production` | Enables Secure cookies and requires HTTPS origins. |
| `EXPO_PUBLIC_API_URL` | Backend origin compiled into the Expo app. Required in release builds. |

`pnpm server` reads a root `.env` file if present. Existing process environment
values take precedence. Expo reads `EXPO_PUBLIC_API_URL` during bundling; changing
the server environment alone does not change an already installed mobile app.
Missing or invalid release configuration disables account controls while keeping
local gameplay available.

For a deployment, build `pnpm --dir web build`, then run `pnpm server` behind an
HTTPS reverse proxy with `NODE_ENV=production`, `APP_ORIGINS=https://your-host`,
and `DATABASE_PATH` on a persistent volume. The server serves `web/dist` and
`/api` together. A static-only web deployment retains offline gameplay, but its
account controls require a same-origin `/api` reverse proxy to this server.
No deployment or hosted database is provisioned by this change.

If an HTTPS reverse proxy forwards requests, configure `TRUSTED_PROXIES` with
only the IP addresses of proxies you control (for example `127.0.0.1,::1` for
a proxy on the same host). The proxy must append the actual connecting peer to
`X-Forwarded-For` or overwrite it with that address. The server walks trusted
hops from right to left and uses the first untrusted address for IP rate limits.
Hostnames, wildcard ranges, and CIDR ranges are rejected. Without this setting,
forwarded headers are ignored and proxied clients share the proxy's rate bucket.
Malformed or oversized chains also fall back to the socket peer. This follows
the [trusted-proxy boundary described for X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For#selecting_an_ip_address).

The database uses WAL and full synchronous writes. Back up a stopped database
or use SQLite's online backup tooling; copying just the main file during writes
can omit committed WAL contents. Treat the database and its backups as private.
Database files, local environment files, and server data are excluded from Git
and EAS uploads.

## Authentication and API

Email addresses are normalized, passwords require 12–128 characters, and salted
scrypt hashes are stored in SQLite. Sessions expire after 30 days and are
revoked on logout. Account creation and replacement of a session commit in one
database transaction; failed writes preserve the previous usable session and
allow registration to be retried. Only a SHA-256 digest of each random session token is stored
in the database. Browser sessions use an HttpOnly, SameSite=Lax cookie scoped to
`/api` (Secure in production). Native sessions use
[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).
Credentials are never part of `gc.*` gameplay exports or local-data resets.

Every account request sends `X-Grim-Client: web` or `native`. Browser mutations
require an allowlisted Origin. Native clients use an Authorization bearer
token; native mode ignores browser cookies. Backup clients send `X-Grim-User`
with the displayed account ID so a shared-cookie account change cannot send a
backup to the wrong account. JSON writes require
`Content-Type: application/json`. No cross-origin wildcard is enabled.

| Endpoint | Action |
| --- | --- |
| `GET /api/health` | Service health. |
| `POST /api/auth/register` | `{name, email, password}`; creates an account and session. |
| `POST /api/auth/login` | `{email, password}`; creates a session. |
| `GET /api/auth/session` | Current `{user, expiresAt}` or `{user:null}`. |
| `POST /api/auth/logout` | Revokes the current session; returns 204. |
| `GET /api/backups` | Metadata for the account's newest ten backups. |
| `POST /api/backups` | `{snapshot: string}` containing a portable `grimcomp.v1` export. |
| `GET /api/backups/:id` | The authenticated owner's backup metadata and snapshot. |

The server limits sign-in/registration attempts by IP and normalized email,
bounds concurrent password hashing and request sizes, and limits backup uploads.
It ignores forwarded IP headers unless the direct peer is explicitly trusted
as described above. Backups are capped
at 960 KiB. Empty snapshots and internal storage keys are rejected. The server
checks the portable envelope; gameplay value validation happens again on each
client before restore. Email verification, forgotten-password recovery, social
login, automatic synchronization, and account deletion are not implemented.

## Verification

```sh
pnpm test:server
pnpm tsc
pnpm --dir web tsc
pnpm --dir web test
pnpm --dir web build
```

Backend tests use temporary SQLite databases and cover normalized registration,
hashed passwords, disk persistence, authentication failures, cookie/Origin
protection, expired and revoked sessions, account isolation, backup limits,
retention, rate limiting, failed session writes, proxy spoofing, and busy-port
startup errors.
