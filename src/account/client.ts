import { MAX_SETTINGS_BACKUP_FILE_BYTES, settingsBackupExceedsFileLimit } from '@grimcomp/core';

export interface AccountUser { readonly id: string; readonly name: string; readonly email: string }
export interface AccountBackup { readonly id: string; readonly createdAt: string; readonly bytes: number }
export interface AccountSession { readonly user: AccountUser | null; readonly initialized: boolean }
export interface AccountTokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  remove(): Promise<void>;
}
interface AccountClientOptions {
  readonly baseUrl: string | null;
  readonly platform: 'web' | 'native';
  readonly tokenStore: AccountTokenStore;
  readonly fetch?: typeof fetch;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const boundedText = (value: unknown, maxLength: number): value is string => (
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
);
function userFrom(value: unknown): AccountUser {
  if (!record(value) || !boundedText(value.id, 128) || !boundedText(value.name, 80) || !boundedText(value.email, 254)) {
    throw new Error('The account server returned an invalid user.');
  }
  return { id: value.id, name: value.name, email: value.email };
}
export interface AccountLogoutResult {
  /** False when the server could not confirm it revoked the session. */
  readonly serverConfirmed: boolean;
}

class ResponseTooLargeError extends Error {
  constructor() { super('The account server response is too large.'); }
}

/**
 * Read at most `maxBytes` of a response body as text. A declared
 * Content-Length over the cap aborts the request before the body is read;
 * otherwise the body is streamed and the request aborted as soon as the cap is
 * crossed. React Native's fetch exposes no body stream (it resolves with the
 * body already buffered natively as a Blob), so there the Blob's size is
 * checked before the text is materialized in JavaScript.
 */
async function readBoundedText(response: Response, maxBytes: number, abort: () => void): Promise<string> {
  const tooLarge = (): never => {
    abort();
    throw new ResponseTooLargeError();
  };
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) tooLarge();

  const body = response.body;
  if (body && typeof body.getReader === 'function' && typeof TextDecoder === 'function') {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        void reader.cancel().catch(() => undefined);
        tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }

  if (typeof response.clone === 'function') {
    const buffered = await response.clone().blob();
    if (buffered.size > maxBytes) tooLarge();
  }
  const text = await response.text();
  if (text.length > maxBytes) tooLarge();
  return text;
}

function backupFrom(value: unknown): AccountBackup {
  if (!record(value) || !boundedText(value.id, 128) || !boundedText(value.createdAt, 64)
    || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.bytes !== 'number'
    || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_SETTINGS_BACKUP_FILE_BYTES) {
    throw new Error('The account server returned an invalid backup.');
  }
  return { id: value.id, createdAt: value.createdAt, bytes: value.bytes };
}

/** Accounts are deliberately separate from the device's journaled gameplay store. */
export class NativeAccountClient {
  private token: string | null = null;
  private version = 0;
  private authBusy = false;
  private restorePromise: Promise<void> | null = null;
  private tokenPersistence: Promise<void> = Promise.resolve();
  private tokenRemovalPending = false;
  private session: AccountSession = { user: null, initialized: false };
  private listeners = new Set<() => void>();
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: AccountClientOptions) {
    this.fetcher = options.fetch ?? fetch;
  }

  get configured(): boolean { return this.options.baseUrl !== null; }
  get sessionVersion(): number { return this.version; }
  getSnapshot = (): AccountSession => this.session;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(user: AccountUser | null): void {
    this.session = { user, initialized: true };
    for (const listener of this.listeners) listener();
  }
  assertSession(version: number): void {
    if (version !== this.version || !this.session.user) throw new Error('Your account changed. Try this action again.');
  }
  private persistToken<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tokenPersistence.then(work);
    this.tokenPersistence = result.then(() => undefined, () => undefined);
    return result;
  }
  private async clearSession(): Promise<void> {
    this.version += 1;
    this.token = null;
    this.publish(null);
    if (this.options.platform === 'native') {
      this.tokenRemovalPending = true;
      await this.removeStoredToken();
    }
  }
  private async removeStoredToken(): Promise<void> {
    await this.persistToken(() => this.options.tokenStore.remove());
    this.tokenRemovalPending = false;
  }

  private async request(path: string, method = 'GET', body?: unknown, authenticated = true): Promise<unknown> {
    if (!this.configured) throw new Error('Accounts are unavailable in this build. The account server has not been configured.');
    const version = this.version;
    const headers: Record<string, string> = { 'X-Grim-Client': this.options.platform };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Reauthentication also identifies the previous native session so the
    // server can rotate it. A failed login still does not invalidate it.
    if (this.options.platform === 'native' && this.token) headers.Authorization = `Bearer ${this.token}`;
    if (authenticated && path.startsWith('/api/backups') && this.session.user) headers['X-Grim-User'] = this.session.user.id;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.fetcher(`${this.options.baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        credentials: this.options.platform === 'web' ? 'include' : 'omit', signal: controller.signal,
      });
      if (version !== this.version) throw new Error('Your account changed. Try this action again.');
      if (response.status === 401 && authenticated) {
        await this.clearSession();
        throw new Error('Your session expired. Sign in again.');
      }
      if (response.status === 409 && authenticated && path.startsWith('/api/backups')) {
        await this.clearSession();
        throw new Error('Your account changed. Check your session and try again.');
      }
      if (response.status === 204 && response.ok) return null;
      const maxResponseBytes = method === 'GET' && path.startsWith('/api/backups/')
        ? MAX_SETTINGS_BACKUP_FILE_BYTES * 6 + 65_536
        : 65_536;
      const raw = await readBoundedText(response, maxResponseBytes, () => controller.abort());
      if (version !== this.version) throw new Error('Your account changed. Try this action again.');
      let data: unknown;
      try { data = JSON.parse(raw) as unknown; }
      catch { throw new Error('The account server returned an unreadable response.'); }
      if (!response.ok) {
        throw new Error(record(data) && typeof data.error === 'string' ? data.error.slice(0, 500) : 'The account request failed.');
      }
      return data;
    } catch (error) {
      // An oversized body aborts the request itself; that is not a timeout.
      if (error instanceof ResponseTooLargeError) throw error;
      if (controller.signal.aborted) throw new Error('The account server took too long to respond. Try again.');
      if (error instanceof TypeError) throw new Error('Could not reach the account server. Check your connection and try again.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  restoreSession(): Promise<void> {
    if (this.restorePromise) return this.restorePromise;
    this.restorePromise = this.restore().finally(() => { this.restorePromise = null; });
    return this.restorePromise;
  }
  private async restore(): Promise<void> {
    if (this.authBusy) throw new Error('An account action is already in progress.');
    this.authBusy = true;
    try {
      if (!this.configured) { this.publish(null); return; }
      if (this.options.platform === 'native') {
        const version = this.version;
        // A failed secure-store deletion must be retried before any token is
        // read back, including a partially persisted sign-in that was rejected.
        if (this.tokenRemovalPending) await this.removeStoredToken();
        const token = await this.persistToken(() => this.options.tokenStore.read());
        if (version !== this.version) throw new Error('Your account changed. Try this action again.');
        this.token = token;
        if (!this.token) { this.version += 1; this.publish(null); return; }
      }
      const data = await this.request('/api/auth/session');
      if (!record(data)) throw new Error('The account server returned an invalid session.');
      if (data.user === null) { await this.clearSession(); return; }
      const user = userFrom(data.user);
      if (user.id !== this.session.user?.id) this.version += 1;
      this.publish(user);
    } finally {
      this.authBusy = false;
    }
  }

  async authenticate(mode: 'login' | 'register', details: { email: string; password: string; name?: string }): Promise<void> {
    if (this.authBusy) throw new Error('An account action is already in progress.');
    if (!/^\S+@\S+\.\S+$/.test(details.email.trim()) || details.email.trim().length > 254) throw new Error('Enter a valid email address.');
    if (details.password.length < (mode === 'register' ? 12 : 1) || details.password.length > 128) {
      throw new Error(mode === 'register' ? 'Use a password between 12 and 128 characters.' : 'Enter your password.');
    }
    if (mode === 'register' && (!details.name?.trim() || details.name.trim().length > 80)) throw new Error('Enter a name between 1 and 80 characters.');
    this.authBusy = true;
    try {
      const version = this.version;
      const data = await this.request(`/api/auth/${mode}`, 'POST', {
        email: details.email.trim().toLowerCase(), password: details.password,
        ...(mode === 'register' ? { name: details.name?.trim() } : {}),
      }, false);
      if (!record(data)) throw new Error('The account server returned an invalid session.');
      const user = userFrom(data.user);
      if (this.options.platform === 'native') {
        if (!boundedText(data.token, 1_024) || /\s/.test(data.token)) throw new Error('The account server did not return a valid sign-in token.');
        const token = data.token;
        try {
          if (this.tokenRemovalPending) await this.removeStoredToken();
          await this.persistToken(() => {
            if (version !== this.version) throw new Error('Your account changed. Try this action again.');
            return this.options.tokenStore.write(token);
          });
        } catch {
          if (version !== this.version) throw new Error('Your account changed. Try this action again.');
          // The server has already rotated the old session. Do not keep
          // displaying that account if its replacement cannot be saved.
          try { await this.clearSession(); } catch { /* Retried before the next restore. */ }
          throw new Error('Could not save your sign-in securely. Try signing in again.');
        }
        if (version !== this.version) throw new Error('Your account changed. Try this action again.');
        this.token = token;
      }
      this.version += 1;
      this.publish(user);
    } finally {
      this.authBusy = false;
    }
  }
  /**
   * Always signs this device out, including offline. Server revocation is
   * attempted first because it needs the session token; whatever it returns,
   * the local session and the saved token are then cleared.
   */
  async logout(): Promise<AccountLogoutResult> {
    if (this.authBusy) throw new Error('An account action is already in progress.');
    this.authBusy = true;
    try {
      let serverConfirmed = false;
      try {
        await this.request('/api/auth/logout', 'POST');
        serverConfirmed = true;
      } catch {
        // Offline, timed out, or already expired: the server session then
        // lapses on its own expiry, and this device is signed out below.
      } finally {
        try {
          await this.clearSession();
        } catch {
          // The in-memory session is already gone; a pending token removal is
          // retried before the next session restore in this process.
          throw new Error('Signed out, but the saved sign-in could not be removed from this device. If the app signs you back in later, sign out again.');
        }
      }
      return { serverConfirmed };
    } finally {
      this.authBusy = false;
    }
  }
  async listBackups(): Promise<readonly AccountBackup[]> {
    this.assertSession(this.version);
    const data = await this.request('/api/backups');
    if (!record(data) || !Array.isArray(data.backups) || data.backups.length > 10) throw new Error('The account server returned an invalid backup list.');
    return data.backups.map(backupFrom);
  }
  async saveBackup(snapshot: string): Promise<AccountBackup> {
    this.assertSession(this.version);
    if (settingsBackupExceedsFileLimit(snapshot)) throw new Error('This backup is larger than the 960 KiB limit.');
    const data = await this.request('/api/backups', 'POST', { snapshot });
    if (!record(data)) throw new Error('The account server returned an invalid backup.');
    return backupFrom(data.backup);
  }
  async getBackup(id: string): Promise<{ backup: AccountBackup; snapshot: string }> {
    this.assertSession(this.version);
    const data = await this.request(`/api/backups/${encodeURIComponent(id)}`);
    if (!record(data) || typeof data.snapshot !== 'string') throw new Error('The account server returned an invalid backup.');
    if (settingsBackupExceedsFileLimit(data.snapshot)) throw new Error('This backup is larger than the 960 KiB limit.');
    const backup = backupFrom(data.backup);
    if (backup.id !== id) throw new Error('The account server returned a different backup.');
    return { backup, snapshot: data.snapshot };
  }
}
