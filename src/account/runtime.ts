import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { NativeAccountClient } from './client';

// Outside gc.*: credentials never enter gameplay exports, imports, or resets.
const SESSION_KEY = 'grimcomp.account.session.v1';
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

export const nativeAccountClient = new NativeAccountClient({
  baseUrl: accountUrl(),
  platform: Platform.OS === 'web' ? 'web' : 'native',
  tokenStore: {
    read: () => SecureStore.getItemAsync(SESSION_KEY),
    write: (token) => SecureStore.setItemAsync(SESSION_KEY, token),
    remove: () => SecureStore.deleteItemAsync(SESSION_KEY),
  },
});
