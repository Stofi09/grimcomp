/** Durable browser-storage schema identity shared by boot migration and writes. */
export const STORAGE_VERSION_KEY = 'gc.storageVersion';
export const STORAGE_VERSION = 1;

/** Restartable destructive-reset intent, reserved from all normal app data paths. */
export const STORAGE_RECOVERY_RESET_INTENT_KEY = 'gc.storage.recoveryResetIntent';
export const STORAGE_RECOVERY_RESET_INTENT_RAW = JSON.stringify({
  kind: 'grimcomp.web.recovery-reset',
  version: 1,
});
// This non-gc witness cannot be installed by any historical portable import.
// Its presence proves the destructive intent came through the confirmed
// recovery UI, even if an older release previously accepted the gc.* key.
export const STORAGE_RECOVERY_RESET_WITNESS_KEY = 'grimcomp.storage.recoveryResetWitness';
export const STORAGE_RECOVERY_RESET_WITNESS_RAW = JSON.stringify({
  kind: 'grimcomp.web.recovery-reset-witness',
  version: 1,
});
