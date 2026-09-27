# Grimcomp on solak.hu

This preparation supports two independently deployed parts:

| Part | Destination | Runtime/state |
| --- | --- | --- |
| Web | `https://grimcomp.solak.hu`, `/srv/grimcomp/current` | Static React/Vite; player data remains in browser localStorage. |
| Optional accounts | Same-origin `/api/`, loopback `127.0.0.1:3030` | One Node 24 process; private SQLite in `/var/lib/grimcomp`. |

The account server is new WIP and uses Node's built-in SQLite. It needs no
PostgreSQL, Redis, external authentication provider, or npm backend installation.
Web requests use HttpOnly cookies; native requests use bearer tokens. Browser
mutations require the exact HTTPS origin. Account backups are explicit save and
restore operations; this is not automatic device synchronization.

The static deployment works with accounts unavailable. Settings keeps its
account controls and displays the controlled API error; local gameplay and
local exports remain available. There is no build-time web account-disable flag.
The default TLS template deliberately returns JSON 503 for `/api/` until the
optional service is ready. It never returns the SPA HTML for an API request.

## Build once, away from the shared VPS

Use a clean, reviewed checkout that contains the current WIP **after it has
been reviewed and committed**. The older HEAD alone does not include the new
account service. The release builder refuses dirty source and records a full
commit in each artifact. It runs core/web checks, web and account tests, local
deployment/SQLite-backup tests, and a production web build.

Requirements: Node 24, pnpm 11.5.0, Python 3.10+, and Git. The CI workflow uses
Ubuntu 24.04. Python has no extra dependencies. The full web suite imports
native modules whose root TypeScript configuration extends Expo; the builder
therefore installs the root workspace with `--frozen-lockfile --ignore-scripts`
as well as the separate web workspace. Root/Expo packages are only build/test
dependencies and never enter either artifact. No signing or store submission
is part of this workflow.

```sh
# Run from a reviewed checkout. OUTPUT must exist outside the checkout.
bash ops/build-release.sh FULL_REVIEWED_COMMIT /absolute/private/artifact-output
```

Outputs are separate `grimcomp-web-COMMIT.tar.gz` and
`grimcomp-api-COMMIT.tar.gz` files and their `.sha256` files. Retrieve the
expected SHA-256 from the trusted build result independently of an untrusted
upload location. The hash verifies artifact identity, not who approved it.
The Node runtime is provisioned and verified separately under
`/opt/grimcomp/node/bin/node`; never alter David's Node/NVM/PM2 installation.

The deterministic packager can also validate an already built output:

```sh
python3 ops/grimcomp-release.py package --kind web --source web/dist \
  --release FULL_REVIEWED_COMMIT --source-commit FULL_REVIEWED_COMMIT \
  --output /absolute/private/grimcomp-web.tar.gz
python3 ops/grimcomp-release.py package --kind api --source server \
  --release FULL_REVIEWED_COMMIT --source-commit FULL_REVIEWED_COMMIT \
  --output /absolute/private/grimcomp-api.tar.gz
```

The standalone packager checks bytes and structure but does not prove a clean
Git checkout or rerun tests; use `build-release.sh` for release provenance.
The web allowlist is index, favicon, fingerprinted assets, and JSON content.
The API allowlist is the four current runtime modules and numbered SQL
migrations. No `.env`, database/WAL/SHM, tests, `.git`, root Expo app, or
`node_modules` is included in either artifact. Newly introduced API modules
require an explicit packaging allowlist update and a packaged-runtime test.

## Static publication and rollback

Run the reviewed publisher as the owner of `/srv/grimcomp` (root on the VPS).
The webserver must have read/traverse access only. First initialization accepts
only an empty destination named `grimcomp`, creates a marker and lock, and
refuses foreign or symlinked directories. Custom `--root` is for an explicit
alternate scoped directory or temporary test root, never another application.

```sh
python3 ops/grimcomp-release.py init
python3 ops/grimcomp-release.py publish \
  --archive /absolute/private/grimcomp-web.tar.gz --sha256 REVIEWED_SHA256
python3 ops/grimcomp-release.py status
python3 ops/grimcomp-release.py rollback --release PREVIOUS_RELEASE_ID
```

The publisher holds one lock, accepts only regular tar members, and rejects
extension metadata before parsing its payload, non-padding bytes after the tar
end marker, unsafe/duplicate archive paths and links. It
enforces size/inventory limits, verifies every file hash, and stages immutable
release directories before atomically replacing only `current`. Repeating the
same artifact is idempotent; reusing its release name for different bytes fails.
Rollback revalidates the retained target release and can replace a managed
current pointer whose old release is corrupt or missing. It still rejects a
pointer outside the managed release layout. No shell commands, service restarts,
nginx reloads, database operations, or deletions of earlier releases occur.

Staging, publication and rollback preserve a fixed **10 GiB free-space
reserve**. Preflight budgets the complete new release (including manifest and
file-block/metadata overhead) plus every additional shared asset copy; both
destination filesystems must have that combined headroom. Existing retained
files already consume reported free space. API staging budgets its payload as
well. The helper rechecks remaining writes and capacity before activation;
space loss aborts without switching `current`. Complete unactivated releases
and any already committed immutable assets can remain after failure. These
checks do not reserve blocks against unrelated writers; keep the shared David
guard running and serialize deployment/backup work. Tests need a temporary
filesystem with this production headroom for their subprocess CLI checks;
low-space cases inject disk observations without lowering the live threshold.

Fingerprint-named assets accumulate under `/srv/grimcomp/assets` so already
open tabs can still load old chunks after a switch. A filename collision with
different bytes fails before activation. There is no automatic retention;
budget disk and prune only through a future separately reviewed retention tool.
An interrupted staging operation may leave a hidden unreferenced stage; a
subsequent publish uses a new stage and does not activate partial data.

Static rollback **does not roll back browser localStorage or the optional
account database**. Export local data before changes to its schema. Keep the
hostname stable; HTTP, localhost and a different domain have different stores.
The current app requires HTTPS/Web Locks. Its startup fetches content JSON;
reliable offline cold starts are not guaranteed by a service worker.

## Nginx and TLS

Files under `nginx/` contain only this host's server/location configuration.
Install the HTTP bootstrap block with the host's established ACME webroot,
obtain a certificate for `grimcomp.solak.hu`, then add the TLS block. Existing
host ingress, default hosts, David sites and certificate renewal setup remain
owned by the shared VPS procedure. Validate the complete config with `nginx -t`
before a graceful reload during the eventual authorized host rollout.

The TLS template assumes `/etc/letsencrypt/live/grimcomp.solak.hu/` and
`/var/lib/letsencrypt`; confirm those against actual host conventions. Serve
index and unhashed content with revalidation, fingerprinted assets with long
caching. The app uses stored-screen navigation, so unknown paths return 404.
Check index, favicon, every manifest pack, correct JS MIME types and Web Locks
boot on HTTPS. This preparation has not edited DNS, obtained certificates,
validated nginx on the VPS or exposed a public hostname.

Security headers: the TLS server sends `Strict-Transport-Security:
max-age=31536000; includeSubDomains` (covering only `*.grimcomp.solak.hu`),
`X-Content-Type-Options`, `Referrer-Policy: same-origin`, `X-Frame-Options`
and a strict Content-Security-Policy for the static app: `default-src 'none'`
with only same-origin scripts, styles, images, JSON (`connect-src`) and fonts
(`font-src 'self' data:`, because Vite inlines the smallest font files), plus
`base-uri 'none'`, `form-action 'self'` and `frame-ancestors 'none'`. The
policy was chosen from the built output, which has no inline scripts or
styles; React sets style properties through CSSOM, which CSP permits, so
`'unsafe-inline'` is not needed. nginx drops server-level `add_header` lines in
any location that declares its own, so every such location restates the whole
set; keep the copies identical (a server test checks this). `/api/` responses
use `default-src 'none'; frame-ancestors 'none'` instead. The proxied API
location hides the Node server's copies of these headers so each is sent once;
Node sends the same values when it serves the app directly. HSTS cannot be
withdrawn quickly once browsers have cached it; publish it only when the host
will stay HTTPS-only.

## Optional API: stage before activation

```sh
python3 ops/grimcomp-release.py init --kind api
python3 ops/grimcomp-release.py stage --kind api \
  --archive /absolute/private/grimcomp-api.tar.gz --sha256 REVIEWED_API_SHA256
```

This creates `/srv/grimcomp-api/releases/RELEASE/server/`. It deliberately does
not create the API `current` pointer or restart a service. Static publication
cannot accidentally advance a SQLite migration. The service template expects
the separately activated `/srv/grimcomp-api/current` to point to the selected
whole release directory, not its `server` subdirectory.

API activation/repeat deployment is an outstanding integration step: it must
serialize with backup and other API deployments, verify Node 24 and the
selected API artifact, take a coherent recovery point before changing a live
schema, stop/drain only `grimcomp-api.service`, switch its selected release,
start one process, and check `/api/health`. Startup creates/migrates SQLite;
the currently implemented schema version is 1. Refuse an automatic rollback
if the old release cannot read the newer schema. Never revert only the main
SQLite file while its process or WAL writers are active. Retain the original
database and matched release before any attended recovery.

Provision a dedicated `grimcomp` identity, private persistent state, the
reviewed Node runtime, and root-owned `/etc/grimcomp/api.env` from the example.
The service's `StateDirectory=grimcomp` creates a private data directory. It
uses port **3030**, distinct from David 3000 and HomeBase 3001. Systemd's
loopback address filter does not isolate ports: a compromised API could still
reach other local TCP services. The shared host must implement its selected
port-aware per-user/network isolation policy before treating this as isolated
public hosting. The prepared resource limits need measurement on the VPS.

`NODE_ENV=production`, `APP_ORIGINS=https://grimcomp.solak.hu` and the proxy's
actual address in `TRUSTED_PROXIES` enable secure browser sessions and reliable
IP rate limits. The Nginx API location overwrites incoming forwarded-address
chains and proxies `/api/` without stripping that prefix. Add this location
only after loopback/API smoke and recovery pass. Release native apps separately
need `EXPO_PUBLIC_API_URL=https://grimcomp.solak.hu` baked into their build.

Sign-up and capacity guards (see `api.env.example`):

| Variable | Default | Effect |
| --- | --- | --- |
| `REGISTRATION_MODE` | `closed` in production, `open` otherwise | `open`, `closed` or `invite`; the effective mode is logged at start-up. |
| `REGISTRATION_INVITE_CODE` | none | Required for `invite`; 12–256 characters, constant-time compared, never logged. |
| `MAX_ACCOUNTS` | `1000` | Registrations beyond it are refused (403 `account_limit`). |
| `MAX_BACKUP_STORAGE_BYTES` | 2 GiB | Uploads that would push all stored snapshots past it are refused (507 `storage_full`). |

Keep the process single: rate limits, the password-hashing queue and upload
slots live in its memory and reset on restart. Its memory budget under
`MemoryMax=512M` is dominated by at most four concurrent scrypt derivations
(about 32 MiB each) and at most four in-flight backup bodies (about 1.9 MiB of
request, plus parsing). `/api/health` queries SQLite and answers 503 when the
database cannot be read, so it is a meaningful post-activation check.

## SQLite backup and recovery readiness

`grimcomp-sqlite-backup.py` uses SQLite's online backup API, including committed
WAL data, explicitly converts the independent copy to a single-file journal
mode, then checks integrity and the supported schema. The live database keeps
its existing journal mode. It verifies the
provided immutable API release before and after capture and writes a private,
atomic bundle containing `database.sqlite`, the API manifest, and checksum
receipt. No service needs stopping for an ordinary backup.

```sh
# BACKUP_PARENT must already be private (0700), owned by the invoking identity.
# Use the canonical manifest path for the actually active API release.
python3 ops/grimcomp-sqlite-backup.py \
  --destination /var/backups/grimcomp/UNIQUE_BACKUP_NAME \
  --api-manifest /srv/grimcomp-api/releases/ACTIVE_RELEASE/MANIFEST.json
```

The caller must select the manifest of the actually active API and serialize
release activation against capture; the helper does not inspect systemd or
claim that its selected artifact is the live process. It refuses overwriting
an existing backup, symlinked inputs, public backup parents, unknown schema
versions and insufficient capacity. Deadline is 60 seconds by default. Run
the job with a host-level runtime/resource limit as well; the SQLite integrity
check and disk hashing are not bounded by the online-backup progress deadline.
Capacity preflight requires **10 GiB plus twice the larger of the logical
database size and the combined main-file/WAL size**, plus receipt overhead.
Every backup progress callback also requires 10 GiB plus the remaining pages
and overhead; receipt writing and final publication recheck the same reserve.
Capacity loss removes only the helper's private incomplete stage and never
publishes a backup bundle. This shares the David guard's disk floor; admission,
concurrent-writer control and ongoing disk monitoring are still required.

Local tests prove committed WAL rows survive reopening the independent copy.
Before account data is considered protected, rehearse restoring a **copy** to
a disposable private directory using the exact archived API release; verify
login/session and backup ownership. Prepare encrypted offsite storage, a
retention policy, disk/backup-freshness monitoring and an attended live-restore
procedure. There is no enabled backup timer, offsite transfer or live-restore
automation in this change. Same-disk backups cannot survive VPS/disk loss.

The API has no email verification or password reset. Registration is closed
by default in production; open it deliberately (`invite` for a known group)
and size `MAX_ACCOUNTS` and `MAX_BACKUP_STORAGE_BYTES` to the POC's audience and
storage budget first. Because there is no email verification, registration
still reveals whether an address already has an account (see
`server/README.md`). Users can change their password, sign out everywhere,
delete single backups and delete their account (web UI; native UI pending).
Each account retains its newest ten uploaded backups; ordinary browser-local
gameplay never reaches the VPS unless explicitly saved.

## Verification

```sh
python3 -m unittest discover -s ops/tests -p 'test_*.py' -v
bash -n ops/build-release.sh
node --test server/*.test.mjs
node --test ops/tests/*.test.mjs
```

Deployment tests use temporary roots and synthetic data: reproducible
packaging; publish/upgrade/rollback; concurrent publication; digest, traversal,
link, duplicate, collision, corrupted-release and foreign-root rejection;
API state exclusion/staging; and WAL-aware backup/reopen/future-schema tests.
Injected disk observations cover stage-plus-retained-asset peak capacity,
API staging, capacity loss during staging/asset copying, full main/WAL backup
estimation, and failed backup progress/final publication without activation.
`deployment-ci.yml` executes the clean builder and uploads artifacts; it has no
deployment credentials or automatic host access.
