# Accounts and database

Grim Companion has an optional account service for the Expo and Vite apps. Open
**Settings → Account & backups** (web: **Account & private backups**) to create an
account, sign in, sign out, save a roster backup, or restore an earlier backup.
The web panel also lets you change your password, sign out everywhere, delete a
single backup, and delete your account. The native app does not offer those
four lifecycle actions yet; the endpoints below are ready for it.

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
Do not run multiple independent database copies behind a load balancer. Rate
limits, the password-hashing queue and upload slots live in process memory, so
the server is meant to run as a **single process**; counters reset on restart.

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
| `NODE_ENV=production` | Enables Secure cookies and HSTS, requires HTTPS origins, and closes registration by default. |
| `REGISTRATION_MODE` | `open`, `closed` or `invite`. Default `open` in development and **`closed` when `NODE_ENV=production`** unless set. The effective mode is logged at start-up. |
| `REGISTRATION_INVITE_CODE` | Required for `invite`: 12–256 characters, compared in constant time and never logged. Generate one with `openssl rand -hex 16`. |
| `MAX_ACCOUNTS` | Maximum number of accounts; default `1000`. Further registrations get a clear 403. |
| `MAX_BACKUP_STORAGE_BYTES` | Ceiling for all stored snapshots together; default `2147483648` (2 GiB). Uploads beyond it get 507. |
| `EXPO_PUBLIC_API_URL` | Backend origin compiled into the Expo app. Required in release builds. |

`pnpm server` reads a root `.env` file if present. Existing process environment
values take precedence. Expo reads `EXPO_PUBLIC_API_URL` during bundling; changing
the server environment alone does not change an already installed mobile app.
Missing or invalid release configuration disables account controls while keeping
local gameplay available. Invalid registration or capacity settings stop the
server at start-up with a message naming the variable.

For a deployment, build `pnpm --dir web build`, then run `pnpm server` behind an
HTTPS reverse proxy with `NODE_ENV=production`, `APP_ORIGINS=https://your-host`,
and `DATABASE_PATH` on a persistent volume. Decide who may sign up and set
`REGISTRATION_MODE` explicitly (for friends, `invite` with a private code). The
server serves `web/dist` and `/api` together. A static-only web deployment
retains offline gameplay, but its account controls require a same-origin `/api`
reverse proxy to this server. No deployment or hosted database is provisioned
by this change.

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
and EAS uploads. `GET /api/health` runs a trivial query against the database
and answers 503 when it cannot be read.

When the Node server serves `web/dist` itself, HTML responses carry the same
strict Content-Security-Policy as the nginx template (`script-src 'self'`,
`style-src 'self'`, `font-src 'self' data:`, `frame-ancestors 'none'`, no
`unsafe-inline`), fingerprinted `/assets/*` files are cached for a year as
`immutable`, and everything else revalidates. Every response sends
`Referrer-Policy: same-origin`, `X-Frame-Options: DENY` and `nosniff`; API
and non-HTML responses get `default-src 'none'`. Production adds HSTS.

## Authentication and API

Email addresses are normalized, passwords require 12–128 characters, and salted
scrypt hashes (`scrypt$N$r$p$salt$key`) are stored in SQLite. Sign-in verifies
with the parameters stored in each hash, bounded so a damaged or hostile value
cannot demand unbounded memory or CPU; an unreadable hash fails with 401. When
a hash uses older parameters, a successful sign-in replaces it with a current
one in the same transaction that issues the session. Sessions expire after 30
days and are revoked on logout. Account creation and replacement of a session
commit in one database transaction; failed writes preserve the previous usable
session and allow registration to be retried. Only a SHA-256 digest of each
random session token is stored in the database. Browser sessions use an
HttpOnly, SameSite=Lax cookie scoped to `/api` (Secure in production). A request
carrying more than one `grimcomp_session` cookie (for example one planted by a
sibling subdomain) is treated as signed out rather than guessing. Native
sessions use [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).
Credentials are never part of `gc.*` gameplay exports or local-data resets.

Every account request sends `X-Grim-Client: web` or `native`. Browser mutations
(POST and DELETE) require an allowlisted Origin. Native clients use an
Authorization bearer token; native mode ignores browser cookies. Backup and
account-lifecycle requests send `X-Grim-User` with the displayed account ID so
a shared-cookie account change cannot act on the wrong account. JSON writes
require `Content-Type: application/json`. No cross-origin wildcard is enabled.

| Endpoint | Action |
| --- | --- |
| `GET /api/health` | Service and database health: `{ok:true}` or 503. |
| `GET /api/auth/registration` | `{mode}`: `open`, `closed` or `invite`. |
| `POST /api/auth/register` | `{name, email, password, inviteCode?}`; creates an account and session. |
| `POST /api/auth/login` | `{email, password}`; creates a session. |
| `GET /api/auth/session` | Current `{user, expiresAt}` or `{user:null}`. |
| `POST /api/auth/logout` | Revokes the current session; returns 204. |
| `POST /api/auth/logout-all` | Revokes every session of the account, this one included; returns 204. |
| `POST /api/auth/password` | `{currentPassword, newPassword}`; revokes every session and issues this client a new one (cookie, or `token` for native). |
| `DELETE /api/account` | `{password}`; deletes the account with its sessions and backups; returns 204. |
| `GET /api/backups` | Metadata for the account's newest ten backups. |
| `POST /api/backups` | `{snapshot: string}` containing a portable `grimcomp.v1` export. |
| `GET /api/backups/:id` | The authenticated owner's backup metadata and snapshot. |
| `DELETE /api/backups/:id` | Deletes one of the owner's backups; returns 204. |

Errors are JSON `{error}`; refusals a client can act on also carry `code`:
`registration_closed`, `invite_required`, `account_limit` (all 403) and
`storage_full` (507). A wrong current password on the password and deletion
endpoints is 403, not 401, so clients do not mistake it for an expired session.

### Limits

- **Per network:** every credential attempt (registration, sign-in, password
  change, account deletion) counts against the client's network: an IPv4
  address, or an IPv6 /64, because one subscriber usually controls a whole /64.
  The default is 30 attempts per 15 minutes.
- **Per account and network:** only *failed* password checks count, keyed by
  email plus network. A stranger on another network therefore cannot lock the
  owner out, and a successful sign-in clears the counter. Default 10 failures
  per 15 minutes.
- Over-limit requests get 429 with `Retry-After` before the body is read, with
  no password hashing and no database write. Counters are in memory, pruned as
  windows expire and capped in number.
- **Password hashing** runs at most four scrypt derivations at once. Further
  requests wait in a FIFO queue of 32 for up to five seconds; only a full queue
  or an expired wait answers 503 with `Retry-After`.
- **Backups:** at most 960 KiB per snapshot. The request body is capped at
  2 × 960 KiB + 4 KiB, because JSON-encoding valid snapshot text at most
  doubles it. Uploads are refused before their body is read when the same
  account already has one in flight (429) or four are in flight overall (503),
  bounding the memory held by request bodies. Each account may make 60 backup
  or session writes per 15 minutes.
- **Capacity:** `MAX_ACCOUNTS` and `MAX_BACKUP_STORAGE_BYTES` (measured after
  per-account retention, so replacing an old backup is not refused).

Empty snapshots and internal storage keys are rejected. The server checks the
portable envelope; gameplay value validation happens again on each client
before restore. Unexpected server errors are logged with their code and message
only, never with request bodies, passwords or tokens.

### Known limitations

- **Account enumeration.** Without email verification, registration must tell
  a user that an address is taken, so `POST /api/auth/register` still answers
  409 for an existing email. The server hashes the password before checking the
  address, so the answer takes as long as a real registration and costs the
  same rate-limited attempt, but the response itself still reveals that the
  address has an account. Sign-in does not leak this: unknown accounts and
  wrong passwords get the same 401 after the same work. Closing the gap needs
  email verification (always answer "check your inbox").
- Email verification, forgotten-password recovery, social login and automatic
  synchronization are not implemented.
- The native app has no UI yet for password change, sign out everywhere,
  backup deletion or account deletion.

## Verification

```sh
pnpm test:server
pnpm tsc
pnpm --dir web tsc
pnpm --dir web test
pnpm --dir web build
```

Backend tests use temporary SQLite databases and cover normalized registration,
hashed passwords with stored-parameter verification and upgrades, disk
persistence, authentication failures, cookie/Origin protection and duplicate
cookies, expired and revoked sessions, account isolation, backup limits and
in-flight bounds, retention and the storage ceiling, registration modes and the
account limit, per-network and failure-only rate limiting (including IPv6 /64
buckets), the hashing queue, failed session writes, password change, sign out
everywhere, backup and account deletion, health probing, security headers and
the nginx templates, proxy spoofing, start-up configuration and busy-port
start-up errors.
