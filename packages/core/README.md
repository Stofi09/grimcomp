# `@grimcomp/core`

Dependency-free, platform-neutral wire schemas and defensive JSON decoders for
Grim Companion. This package must not import React, DOM, Expo, storage, network,
or filesystem APIs.

Both the Expo app and the separate web workspace resolve this private package
from TypeScript source. Its public surface is `src/index.ts`; consumers must
import `@grimcomp/core` rather than reaching into package internals.

Run `pnpm run typecheck` and `pnpm run check:boundary` from this package (or the
equivalent root scripts) before changing the wire contract. Decoders return
structured, path-aware diagnostics and never trust persisted or imported JSON.

## Wire-contract rules

- Fixed-shape schema objects fail closed on unknown keys. Put intentionally
  forward-compatible JSON data under an explicit `extensions` field instead.
- Decoded dictionaries and extension objects have null prototypes. Decoders
  inspect only own enumerable data properties and reject accessors, sparse or
  decorated arrays, symbols, cycles, and values that cannot be reflected safely.
- `grimcomp.exchange.v1` is self-contained: every active source selection,
  campaign lock, and supplied character lock must resolve against included
  content metadata identified by the `(id, version)` pair.
- Source selections are active when `enabled` or `required` is true. A disabled,
  non-required selection is ignored unless a campaign activates it as a house
  rule. Required missing packs always block; otherwise `policy.missingPack`
  decides whether missing metadata is an error or a warning.
- Campaign and source-bound character locks contain exactly the active source
  selections in ascending `order`. Lock versions must satisfy the selection
  range, and pins and hashes must match when supplied.
- Concrete pinned/locked resolutions enforce required dependency ranges and
  declared conflicts. Optional dependencies may be absent, but must satisfy
  their declared range when present. In mixed pinned/unpinned source profiles,
  the candidate set must contain at least one version that satisfies the full
  dependency/conflict graph. Ambiguous source resolution is searched with a
  fail-closed bound of 128 ambiguous relationship-bearing packs, 20,000 candidate
  attempts, and 50,000 charged graph, constraint, range-parse, and search work units.
- Every resolved `DefinitionRef.packId` in a bound character must occur in the
  source's active selections or the campaign lock. Legacy values without a
  resolvable pack belong in `unresolvedRefs`, not in a fabricated reference.
- Source policy enforces `allowedRightsStatuses` and `allowHomebrew` against the
  resolved metadata. User-authored origin or rights basis counts as homebrew.

Versions follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
Supported ranges follow the documented
[node-semver range semantics](https://github.com/npm/node-semver#ranges) for
exact and partial versions, `x`/`X`/`*` wildcards, comparators, caret, tilde,
hyphen ranges, whitespace intersections, and `||` alternatives. Malformed and
unsupported syntax is reported separately from an ordinary supported non-match.

## Defensive limits

Each decode accepts at most 10,000 visited nodes, 5,000 entries per array, and
10,000 reflected own keys per object or array, plus 64 nested extension
container levels. Integer fields must remain within JavaScript's safe integer
range. Semantic-version candidates are capped at 256 characters and ranges at
4,096 raw characters, with bounded alternatives and comparator atoms. These
limits are part of the untrusted-input boundary and should change only alongside
explicit compatibility tests.

## Crash-recoverable storage transactions

The storage kernel is platform-neutral and operates only on already-serialized
`string | null` values through the asynchronous `RawAsyncKeyValue` adapter.
Create a coordinator with `createStorageCoordinator`, call `recover()` once at
startup, and submit one or more unique-key mutations with `transact()`. Calls are
serialized FIFO within a coordinator. Platforms should inject an exclusive-lock
wrapper when separate processes or browser tabs share the same store.

Every transaction captures its before-images while holding that lock, writes and
reads back the versioned `gc.storage.transaction` journal, writes and reads back
each after-image, then removes and verifies removal of the journal. Callers may
publish only after the explicit `committed` outcome, or expose an optimistic
value while clearly marking it pending/dirty and reconciling it on every failure;
they must never claim durability early. An optional `expected` raw value provides
compare-and-set protection: omission is unconditional, `null` requires an absent
key, and a string requires an exact raw match under the lock.

Coordinators begin blocked and dirty until startup recovery verifies a clean
store. A valid interrupted journal is completed forward only when every current
value still equals its recorded before- or after-image. Divergence, unreadable
keys, corrupt journals, unverifiable writes, and failed rollback leave storage
visibly blocked and preserve the marker for diagnosis or a later retry. The
coordinator exposes `pending`, `dirty`, `blocked`, and phase state through
`getStatus()` and `subscribe()`; results and failures are structured and never
claim durability without read-back verification.

Journal decoding accepts only JSON text, rejects unknown fields, duplicate or
reserved operation keys, invalid ids, unsupported versions, non-raw values, and
markers above the defensive size limit. The persisted marker is never trusted as
a typed object.

## Portable settings-backup boundary

`settingsBackup.ts` defines the small contract shared by the native and web
Settings exporters: schema tag `grimcomp.v1`, a 960 KiB UTF-8 file cap sized to
leave transaction-journal headroom, and the platform-local key filter. `gc.newchar.draft` and `gc.newchar.step` are excluded
because web and native intentionally persist different runtime shapes for an
unfinished wizard. Platform adapters remain responsible for validating every
included key/value and for applying an accepted import transactionally.
