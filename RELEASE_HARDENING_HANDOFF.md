# Release-hardening handoff

Finalized on 2026-08-30 after the user resumed the work. This document supersedes the stop-point handoff written on 2026-08-29.

## Executive outcome

- Branch: `codex/release-hardening`
- Base: `origin/main` at `e86d3fc`
- Implementation HEAD before this document commit: `15ce519`
- Branch state before this document commit: 11 commits ahead of `origin/main`; only this handoff file remained untracked
- Aggregate branch diff before this document commit: 167 files, 34,420 insertions, 1,502 deletions
- Final web suite: 58/58 files and 722/722 tests passed
- Root, core, and web TypeScript checks passed
- Web ESLint, production build, package-boundary check, scratch-file gate, iOS configuration audit, and `git diff --check` passed
- No branch was pushed, no PR was opened, and nothing was deployed, submitted, or released

The implementation work requested in the original six-phase plan is complete locally. A real-device/native smoke test, a real multi-tab browser smoke test, code review, push/PR, and release submission remain operational follow-ups rather than unfinished implementation.

## Direction changes and chronology

1. The user asked for web research into how the project could be improved.
2. The user asked for a detailed plan using subagents before implementation.
3. Research and repository audits were split across shared contracts, browser persistence, native persistence, gameplay transactions, content/import safety, and release verification.
4. Implementation began on `codex/release-hardening`, with a preservation checkpoint created before changing the inherited dirty worktree.
5. On 2026-08-29 the user said to stop and document everything. Active implementation agents were interrupted. No further implementation, test repair, commit, push, deployment, stash, or destructive cleanup was performed after that stop request. The original version of this file captured the exact dirty state and red tests.
6. The user later said `continue`. Work resumed from that handoff rather than restarting or discarding anything.
7. The remaining web, native, gameplay, compatibility, content/import, recovery, and test work was completed. Independent read-only audits found several last-edge cases; each production-path blocker was repaired and covered before the final matrix was run.
8. The completed changes were committed in dependency order with explicit path staging. No blanket staging, destructive Git command, push, or deployment was used.

## Research and resulting design decisions

The work used primary or official references:

- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): persisted producer versions are strict SemVer, and unsupported future schemas are rejected rather than guessed.
- [node-semver range semantics](https://github.com/npm/node-semver#ranges): compatibility/range resolution has explicit, tested semantics instead of ad-hoc string comparison.
- [MDN Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) and the [W3C Web Locks specification](https://www.w3.org/TR/web-locks/): same-origin recovery, writes, resets, imports, exports, and snapshots share an exclusive lock.
- [MDN Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API): `localStorage` access is synchronous and may throw; storage events are treated as untrusted wakeups, not authoritative payloads.
- [AsyncStorage repository](https://github.com/react-native-async-storage/async-storage) and [AsyncStorage usage documentation](https://react-native-async-storage.github.io/3.0/api/usage/): values are serialized strings, and installed `multi*` helpers are not treated as a portable atomic boundary.

The resulting model is deliberately fail-closed:

- A single reserved journal records exact before/after images.
- Every decision-dependent read is protected by compare-and-set preconditions.
- Recovery runs before application state becomes readable.
- Storage-version markers are reserved from ordinary writes.
- Transactions publish to React only after durable verification.
- No-op application updates still acquire the lock and verify CAS, but a fully unchanged transaction skips journal/write churn.
- Browser persistence refuses to boot in a real browser without Web Locks. The fallback page explains that a current browser in a secure HTTPS context is required.
- Native uses verified single-key AsyncStorage operations behind the shared journal because no stronger portable primitive is assumed.

## Multi-agent workstreams and review findings

The plan was parallelized into these bounded streams:

- Shared wire schemas, strict decoders, compatibility resolution, diagnostics, and package boundaries
- Crash-recoverable storage coordinator plus fault injection
- Native boot, migrations, reset recovery, import/export, and cache/store integration
- Browser boot, migrations, Web Locks, storage-event synchronization, import/export, and cache integration
- XP/progression transactions
- Roster creation/deletion transactions
- Combat, wounds, criticals, and end-of-scene transactions
- Content-pack validation and exact post-import roster resolution
- Legacy adapters and golden fixtures
- Final web/native/core audits

Important findings from the final audits and how they were resolved:

- Functional no-op updates were issuing redundant raw writes under React Strict Mode. The coordinator now performs locked CAS verification and then returns without writing a journal when every operation is unchanged.
- Browser fallback without Web Locks was unsafe across tabs. Production now fails closed before touching gameplay state; tests inject an explicit single-process lock.
- A failed journal-triggered browser snapshot could suppress later application-key wakeups. Every `gc.*` event now schedules a coalesced locked resync, with regression coverage.
- A corrupt raw-cache entry that had already disappeared durably could remain dirty. Clear candidates now include both parsed and raw cache keys.
- Direct settings-import callers could omit exact roster context. Roster-affecting imports now require bundled or resolved template context.
- Direct roster exports could omit exact bundled context, and character exports could miss a custom/bundled collision. All settings exports now require exact bundled content at runtime, and character custom maps are validated against the exactly resolved roster.
- Imported content could delete or orphan the required fallback character `c1`, or invalidate the active pointer. Mutations/imports resolve the exact post-change roster and reject these states atomically.
- Legacy stored `c1` tombstones are sanitized for runtime compatibility without discarding unrelated imported content.
- Content validation had potentially unbounded hostile traversals and diagnostics. Counts, depth, messages, paths, pack lists, section sizes, and diagnostic output are bounded.
- Legacy decoding needed safer object/origin handling, lone-surrogate handling, and strict producer versions. These cases are now covered by adversarial and golden fixtures.
- Native wound/critical actions needed one atomic state transition and stable occurrence identity. They now use a pure transition helper with rollback and duplicate-occurrence tests.

## Completed implementation by phase

### 1. Preservation, talent convergence, content validation, and CI

- Checkpointed the inherited in-progress web/content work before hardening it.
- Made talent-rank migration finite, idempotent, and convergent under Strict Mode.
- Added strict, nested character-template validation.
- Removed scratch diagnostics, added a scratch-file CI gate, and bounded test timeouts.
- Updated the CI/package setup for the shared core workspace.

### 2. Shared contracts and compatibility

- Added `@grimcomp/core` with versioned wire types and strict decoders.
- Added bounded diagnostics and explicit compatibility/range resolution.
- Added strict SemVer validation for persisted producer versions.
- Added a legacy-v1 adapter/decode layer rather than allowing legacy guesses inside current decoders.
- Added golden common, envelope, malformed, unresolved, and adversarial fixtures.
- Added journal-key length bounds that reserve suffix capacity for backend namespaces.

### 3. Crash-recoverable storage kernel

- Added journal parsing/serialization and exact before/after operations.
- Added FIFO coordination, optional exclusive locking, compare-and-set preconditions, limits, recovery, rollback, and status subscriptions.
- Added computed transactions used for locked enumeration/snapshots and namespace clears.
- Added all-no-op CAS barriers that remain race-safe but do not emit journal or data writes.
- Added extensive injected-fault tests for partial writes, failures before/after writes, malformed journals, rollback, recovery, limits, listener errors, and coordination races.

### 4. Native persistence and recovery

- Added the raw AsyncStorage adapter using verified single-key operations.
- Added strict native storage migrations and a pre-React recovery/migration/preload gate.
- Added a synchronous optimistic store with durability tickets, FIFO/CAS persistence, ambient transactions, atomic publication, reconciliation, status, coherent snapshots, and maintenance barriers.
- Added restartable, witnessed local-data reset recovery.
- Added native settings schema/key/value validation, size/count limits, import/export, and reset handling.
- Added startup validation for active character, custom roster, overlays, content layers, and corrupted values.
- Prevented a delayed failed-write reconciliation from overwriting a newer optimistic revision.

### 5. Browser persistence, cross-tab safety, and content/import portability

- Added browser raw/storage adapters and a hard storage-schema fence.
- Added recovery, migrations, locked authoritative snapshots, and React boot gating.
- Added a coalesced storage-event controller; event values are never trusted directly.
- Added proactive recovery when a journal-open event is the writer's last event.
- Added fail-closed Web Locks capability handling with a non-destructive boot error screen.
- Added durable, persist-before-publish `StorageCore` semantics with cache/raw-cache tracking, completion tickets, nested transactions, status, exact rollback/reconciliation, reserved keys, and schema quarantine.
- Added journaled, coherent settings import/export/reset. Internal keys are excluded, raw corruption is identified, schemas are checked before and after snapshots, and exact roster portability is enforced.
- Added bounded content-pack storage, validation, enabled-pack collection, collision checks, fallback preservation, and atomic add/replace/enable/remove behavior.
- Added exact post-import template resolution across bundled packs, enabled stored packs, edits, tombstones, customs, and active-character state.

### 6. Atomic gameplay operations

- Grouped XP and characteristic/skill/career/talent changes into one transaction.
- Added in-flight action guards to prevent duplicate progression actions.
- Grouped character creation, draft reset, step reset, and activation.
- Grouped roster deletion, every known character overlay removal, and active-character fallback.
- Grouped hit resolution across Wounds, Advantage, and generated criticals.
- Grouped cheat death across Fate and Wounds.
- Grouped native end-of-scene Fortune refresh, critical healing, and condition ticking.
- Made wounds, criticals, recovery, weapon/armour, content, and roster success feedback wait for confirmed durability.
- Added success, grouping, stale-update, duplicate-action, mid-write failure, rollback, and UI regression tests.

## Implementation commit ledger

The implementation commits after `origin/main` are listed below, oldest first; the handoff document is committed separately after this ledger:

1. `8ffee68 chore: checkpoint in-progress web work`
2. `faa4512 fix(talents): make rank migration finite and convergent`
3. `69e2b78 fix(content): validate complete character templates`
4. `8327bb1 ci(web): bound tests and reject scratch diagnostics`
5. `0d2fb97 feat(core): add versioned shared wire schemas`
6. `91b39bc feat(core): add crash-recoverable storage transactions`
7. `4843be1 feat(storage): make native persistence recoverable`
8. `590b559 feat(core): harden transactions and legacy compatibility`
9. `1ba67e4 feat(native): make gameplay mutations recoverable`
10. `4f8bdff feat(web): enforce atomic storage and portable content`
11. `15ce519 feat(gameplay): make multi-key actions durable`

The first commit is intentionally a preservation checkpoint, not an isolated release-ready unit. The later commits harden and verify that preserved feature work.

## Final verification ledger

Final commands run after the last source/test change:

```text
pnpm --dir web test -- --reporter=dot
  58 test files passed
  722 tests passed

pnpm --dir web build
  192 modules transformed
  production build passed

pnpm --dir web lint
  passed with no errors or warnings

pnpm tsc
  passed

pnpm run tsc:core
  passed

pnpm run check:core-boundary
  passed

pnpm --dir web run check:no-scratch
  passed; no scratch files under web/src

pnpm run audit:ios
  passed; no configuration blockers reported

git diff --check
  passed
```

Focused suites were also repeatedly run while repairing failures. The last focused storage/settings run passed 110/110 tests; the last browser/core-storage run passed 95/95 tests; the pre-freeze release slice passed 169/169 tests. Earlier red runs were test-harness/context regressions during the conversion and were resolved before the final matrix.

## Safety and recovery invariants now covered

- No success message is shown before a requested durable action succeeds.
- A failed multi-key action does not leave a partially published React snapshot.
- A crash after journal creation can complete or roll back from exact images.
- A write based on stale state fails its precondition instead of silently clobbering another writer.
- A future/different schema is quarantined and cannot be reopened by a marker rollback.
- Reset authorization uses a separate durable witness and is restartable after interruption.
- Import/export refuses reserved internal keys and rejects malformed, oversized, colliding, orphaning, or non-portable data.
- Required fallback character `c1` survives content changes and legacy stored tombstones.
- Browser cross-tab work is serialized by the same named Web Lock.
- Browser startup does not silently degrade to unsafe tab-local coordination.
- Native and browser transitions preserve exact raw baselines needed for repair/recovery.

## Remaining operational limitations

These are explicit boundaries, not known red tests:

- Browser persistence requires the Web Locks API in a secure context. Unsupported browsers intentionally receive a blocking compatibility screen.
- Correctness assumes application writers cooperate with the journal/lock protocol. Arbitrary third-party code writing the same `gc.*` keys directly can violate those guarantees.
- Browser recovery and the following authoritative snapshot use consecutive lock acquisitions. A new writer in the gap causes a safe failed resync/retry rather than partial publication.
- Native coordination is per JavaScript process because the AsyncStorage adapter exposes no portable cross-process exclusive lock.
- `localStorage` remains synchronous; the hardening bounds hostile work but does not turn it into an asynchronous database.
- Automated tests use deterministic storage adapters and a test Web Lock. A manual two-tab browser exercise and a native simulator/device smoke test were not run in this task.
- The iOS audit checked project configuration only; no EAS build or TestFlight submission was started.
- No load/performance benchmark, accessibility audit, remote telemetry validation, security penetration test, push, PR, or deployment was requested or performed.

## Recommended next actions

1. Review the 11-commit branch, especially the checkpoint commit plus the four final hardening commits.
2. Run a short manual browser smoke test over HTTPS with two tabs: concurrent edits, import/export, reload recovery, and a simulated interrupted journal.
3. Run native smoke tests on the intended iPhone/iPad simulator or device: boot recovery, progression, roster creation/deletion, hit/critical/wounds flows, settings import/export, and reset.
4. Push/open a PR only when explicitly authorized.
5. Build or submit a release only after review and the manual smoke tests.

## Explicit non-actions

- No user data was deleted.
- No unrelated dirty work was discarded.
- No stash, reset, checkout-overwrite, force operation, or destructive cleanup was used.
- No branch was pushed.
- No PR was opened.
- No deployment, EAS build, App Store/TestFlight submission, or release publication was performed.
