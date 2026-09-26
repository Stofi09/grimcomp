/**
 * Production fails closed without a cross-tab Web Lock. Node exposes
 * `navigator` from v21 but `navigator.locks` only from v24, so tests that bypass
 * main.tsx install an explicit single-process lock instead of depending on the
 * runtime's version.
 */
export function installTestWebLocks(): void {
  if (typeof navigator === 'undefined' || navigator.locks) return;
  const locks = {
    request: async <T>(
      _name: string,
      _options: LockOptions,
      callback: () => Promise<T>,
    ): Promise<T> => callback(),
  } as unknown as LockManager;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
}
