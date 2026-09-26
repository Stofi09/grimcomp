export interface AccountUser {
  id: string;
  name: string;
  email: string;
}

export interface AccountSession {
  user: AccountUser | null;
  expiresAt?: string;
}

export interface BackupMetadata {
  id: string;
  createdAt: string;
  bytes: number;
}

export class AccountApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AccountApiError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const invalidResponse = (): never => {
  throw new AccountApiError('The account service returned an invalid response. Please try again.', 502);
};

function readSession(value: unknown): AccountSession {
  if (!isRecord(value)) return invalidResponse();
  if (value.user === null) return { user: null };
  const user = value.user;
  if (
    !isRecord(user) || typeof user.id !== 'string'
    || typeof user.name !== 'string' || typeof user.email !== 'string'
    || typeof value.expiresAt !== 'string'
  ) return invalidResponse();
  return {
    user: { id: user.id, name: user.name, email: user.email },
    expiresAt: value.expiresAt,
  };
}

function readBackup(value: unknown): BackupMetadata {
  if (
    !isRecord(value) || typeof value.id !== 'string'
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes)
    || value.bytes < 0 || value.bytes > MAX_SETTINGS_BACKUP_FILE_BYTES
  ) return invalidResponse();
  return { id: value.id, createdAt: value.createdAt, bytes: value.bytes };
}

async function readResponse(response: Response, limit: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (declaredLength > limit) {
    await response.body?.cancel();
    return invalidResponse();
  }
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return invalidResponse();
      }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally { reader.releaseLock(); }
  try { return JSON.parse(chunks.join('')); }
  catch { return undefined; }
}

async function request(path: string, body?: unknown, expectedUserId?: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'X-Grim-Client': 'web',
        ...(expectedUserId === undefined ? {} : { 'X-Grim-User': expectedUserId }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (response.status === 204) return undefined;
    // A JSON string can expand to six bytes per original byte when escaped.
    const limit = path.startsWith('/backups/') ? MAX_SETTINGS_BACKUP_FILE_BYTES * 6 + 4096 : 64 * 1024;
    const result = await readResponse(response, limit);
    if (!response.ok) {
      const message = isRecord(result) && typeof result.error === 'string'
        ? result.error
        : response.status === 401
          ? 'Your session has expired. Please log in again.'
          : 'The account service is unavailable. Your local characters are still available.';
      throw new AccountApiError(message, response.status);
    }
    if (result === undefined) return invalidResponse();
    return result;
  } catch (error) {
    if (error instanceof AccountApiError) throw error;
    throw new AccountApiError(
      'Cannot reach the account service. Your local characters are still available. Please try again when connected.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const accountApi = {
  async session(): Promise<AccountSession> {
    return readSession(await request('/auth/session'));
  },
  async login(email: string, password: string): Promise<AccountSession> {
    const session = readSession(await request('/auth/login', { email, password }));
    if (!session.user) return invalidResponse();
    return session;
  },
  async register(name: string, email: string, password: string): Promise<AccountSession> {
    const session = readSession(await request('/auth/register', { name, email, password }));
    if (!session.user) return invalidResponse();
    return session;
  },
  async logout(): Promise<void> {
    await request('/auth/logout', {});
  },
  async listBackups(expectedUserId?: string): Promise<BackupMetadata[]> {
    const result = await request('/backups', undefined, expectedUserId);
    if (!isRecord(result) || !Array.isArray(result.backups) || result.backups.length > 10) return invalidResponse();
    return result.backups.map(readBackup);
  },
  async saveBackup(snapshot: string, expectedUserId?: string): Promise<BackupMetadata> {
    const result = await request('/backups', { snapshot }, expectedUserId);
    if (!isRecord(result)) return invalidResponse();
    return readBackup(result.backup);
  },
  async getBackup(id: string, expectedUserId?: string): Promise<{ backup: BackupMetadata; snapshot: string }> {
    const result = await request(`/backups/${encodeURIComponent(id)}`, undefined, expectedUserId);
    if (!isRecord(result) || typeof result.snapshot !== 'string') return invalidResponse();
    const backup = readBackup(result.backup);
    if (backup.id !== id) return invalidResponse();
    return { backup, snapshot: result.snapshot };
  },
};
import { MAX_SETTINGS_BACKUP_FILE_BYTES } from '@grimcomp/core';
