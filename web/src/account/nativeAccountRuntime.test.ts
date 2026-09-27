import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => {
  // Expo's bundler defines __DEV__; runtime.ts reads it at module load.
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  return {
    WHEN_UNLOCKED: 'when-unlocked',
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
    calls: [] as string[],
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
  };
});

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-secure-store', () => secureStore);

const { nativeAccountTokenStore } = await import('../../../src/account/runtime');

const KEY = 'grimcomp.account.session.v1';
const THIS_DEVICE_ONLY = { keychainAccessible: 'when-unlocked-this-device-only' };

beforeEach(() => {
  secureStore.calls.length = 0;
  secureStore.getItemAsync.mockReset().mockResolvedValue('saved-session');
  secureStore.setItemAsync.mockReset().mockImplementation(async () => { secureStore.calls.push('set'); });
  secureStore.deleteItemAsync.mockReset().mockImplementation(async () => { secureStore.calls.push('delete'); });
});

describe('native account token storage', () => {
  it('keeps the session token in this-device-only keychain storage', async () => {
    await expect(nativeAccountTokenStore.read()).resolves.toBe('saved-session');
    await nativeAccountTokenStore.write('rotated-session');
    await nativeAccountTokenStore.remove();

    expect(secureStore.getItemAsync).toHaveBeenCalledWith(KEY, THIS_DEVICE_ONLY);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(KEY, 'rotated-session', THIS_DEVICE_ONLY);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(KEY, THIS_DEVICE_ONLY);
  });

  it('replaces rather than updates an existing item so its accessibility is re-applied', async () => {
    await nativeAccountTokenStore.write('rotated-session');
    expect(secureStore.calls).toEqual(['delete', 'set']);
  });
});
