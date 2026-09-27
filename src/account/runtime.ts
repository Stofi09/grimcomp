import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { NativeAccountClient, type AccountTokenStore } from './client';

// Outside gc.*: credentials never enter gameplay exports, imports, or resets.
const SESSION_KEY = 'grimcomp.account.session.v1';
// The session token stays on this device: it is readable only while the device
// is unlocked and is excluded from backups and device-to-device migration.
const TOKEN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
function accountUrl(): string | null {
  const value = configuredUrl || (__DEV__ ? 'http://localhost:3001' : null);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(__DEV__ && url.protocol === 'http:')) return null;
    return value;
  } catch { return null; }
}

export const nativeAccountTokenStore: AccountTokenStore = {
  read: () => SecureStore.getItemAsync(SESSION_KEY, TOKEN_OPTIONS),
  // Updating an existing keychain item keeps its original accessibility, so
  // replace it instead: a token saved by an older build (default,
  // backup-migratable accessibility) moves to this-device-only at sign-in.
  write: async (token) => {
    await SecureStore.deleteItemAsync(SESSION_KEY, TOKEN_OPTIONS);
    await SecureStore.setItemAsync(SESSION_KEY, token, TOKEN_OPTIONS);
  },
  remove: () => SecureStore.deleteItemAsync(SESSION_KEY, TOKEN_OPTIONS),
};

export const nativeAccountClient = new NativeAccountClient({
  baseUrl: accountUrl(),
  platform: Platform.OS === 'web' ? 'web' : 'native',
  tokenStore: nativeAccountTokenStore,
});
