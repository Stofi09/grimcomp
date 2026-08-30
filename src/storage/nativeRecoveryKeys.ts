/** Reserved durable marker for an explicitly confirmed, restartable recovery reset. */
export const NATIVE_RECOVERY_RESET_INTENT_KEY = 'gc.storage.recoveryResetIntent' as const;
export const NATIVE_RECOVERY_RESET_INTENT_RAW = JSON.stringify({
  kind: 'grimcomp.native.recovery-reset',
  version: 1,
});

/**
 * Confirmation provenance deliberately lives outside the portable gc.*
 * namespace, so imports and journal recovery cannot synthesize authorization.
 */
export const NATIVE_RECOVERY_RESET_WITNESS_KEY = 'grimcomp.native.recoveryResetWitness' as const;
export const NATIVE_RECOVERY_RESET_WITNESS_RAW = JSON.stringify({
  kind: 'grimcomp.native.recovery-reset-witness',
  version: 1,
});
