import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SETTINGS_BACKUP_FILE_BYTES } from '@grimcomp/core';
import { accountApi, AccountApiError } from './api';

const user = { id: 'user-1', name: 'Marta', email: 'marta@example.com' };
const session = { user, expiresAt: '2026-10-01T00:00:00.000Z' };
const backup = { id: 'backup-1', createdAt: '2026-09-12T12:00:00.000Z', bytes: 123 };

function mockResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(
    status === 204 ? null : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('account API client', () => {
  it('uses the same-origin API, cookies and the application header to log in', async () => {
    const fetchMock = mockResponse(session);
    expect(await accountApi.login('marta@example.com', 'long password')).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'X-Grim-Client': 'web', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'marta@example.com', password: 'long password' }),
    }));
  });

  it('checks a session without sending a request body or storing a token', async () => {
    const fetchMock = mockResponse({ user: null });
    expect(await accountApi.session()).toEqual({ user: null });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/session');
    expect(options).toMatchObject({ method: 'GET', credentials: 'include', headers: { 'X-Grim-Client': 'web' } });
    expect(options.body).toBeUndefined();
  });

  it('registers with the account name and accepts a 204 logout response', async () => {
    const fetchMock = mockResponse(session);
    await accountApi.register('Marta', user.email, 'long password');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
      body: JSON.stringify({ name: 'Marta', email: user.email, password: 'long password' }),
    }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(accountApi.logout()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'include' }));
  });

  it('preserves structured API errors and 401 status for session invalidation', async () => {
    mockResponse({ error: 'Invalid email or password.' }, 401);
    await expect(accountApi.login(user.email, 'wrong password')).rejects.toMatchObject({
      name: 'AccountApiError', status: 401, message: 'Invalid email or password.',
    });
  });

  it('handles offline and malformed server responses without exposing transport details', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(accountApi.session()).rejects.toThrow('Your local characters are still available');
    fetchMock.mockResolvedValueOnce(new Response('<html>Static web host</html>'));
    await expect(accountApi.session()).rejects.toBeInstanceOf(AccountApiError);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 123 } })));
    await expect(accountApi.session()).rejects.toMatchObject({ status: 502 });
  });

  it('saves snapshots explicitly and encodes backup IDs when reading them', async () => {
    const fetchMock = mockResponse({ backup });
    const snapshot = '{"$schema":"grimcomp.v1","gc.c1.wounds":4}';
    expect(await accountApi.saveBackup(snapshot, user.id)).toEqual(backup);
    expect(fetchMock).toHaveBeenCalledWith('/api/backups', expect.objectContaining({
      body: JSON.stringify({ snapshot }),
      headers: expect.objectContaining({ 'X-Grim-User': user.id }),
    }));
    const encodedBackup = { ...backup, id: 'id/with?syntax' };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ backup: encodedBackup, snapshot })));
    expect(await accountApi.getBackup(encodedBackup.id, user.id)).toEqual({ backup: encodedBackup, snapshot });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/backups/id%2Fwith%3Fsyntax', expect.objectContaining({
      credentials: 'include', headers: expect.objectContaining({ 'X-Grim-User': user.id }),
    }));
  });

  it('rejects malformed backup metadata instead of rendering invalid dates or sizes', async () => {
    mockResponse({ backups: [{ ...backup, bytes: -3 }] });
    await expect(accountApi.listBackups()).rejects.toMatchObject({ status: 502 });
  });

  it('rejects oversized metadata, excess list entries and mismatched backup IDs', async () => {
    const fetchMock = mockResponse({ backups: [{ ...backup, bytes: MAX_SETTINGS_BACKUP_FILE_BYTES + 1 }] });
    await expect(accountApi.listBackups()).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ backups: Array(11).fill(backup) })));
    await expect(accountApi.listBackups()).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ backup, snapshot: '{}' })));
    await expect(accountApi.getBackup('another-backup')).rejects.toMatchObject({ status: 502 });
  });

  it('asks which registrations the server accepts and sends an invite code only when given', async () => {
    const fetchMock = mockResponse({ mode: 'invite' });
    expect(await accountApi.registrationMode()).toBe('invite');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/registration', expect.objectContaining({
      method: 'GET', credentials: 'include', headers: { 'X-Grim-Client': 'web' },
    }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ mode: 'public' })));
    await expect(accountApi.registrationMode()).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(session)));
    await accountApi.register('Marta', user.email, 'long password', 'friends-of-the-grim');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/register', expect.objectContaining({
      body: JSON.stringify({ name: 'Marta', email: user.email, password: 'long password', inviteCode: 'friends-of-the-grim' }),
    }));
  });

  it('keeps the machine-readable reason of a refused request', async () => {
    mockResponse({ error: 'Enter the invite code from the server owner.', code: 'invite_required' }, 403);
    await expect(accountApi.register('Marta', user.email, 'long password')).rejects.toMatchObject({
      name: 'AccountApiError', status: 403, code: 'invite_required', message: 'Enter the invite code from the server owner.',
    });
  });

  it('changes the password for the displayed account and returns the rotated session', async () => {
    const fetchMock = mockResponse(session);
    expect(await accountApi.changePassword('old password', 'a brand new passphrase', user.id)).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/password', expect.objectContaining({
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'X-Grim-Client': 'web', 'X-Grim-User': user.id, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'old password', newPassword: 'a brand new passphrase' }),
    }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user: null })));
    await expect(accountApi.changePassword('old password', 'a brand new passphrase', user.id)).rejects.toMatchObject({ status: 502 });
  });

  it('signs out everywhere and deletes backups or the account for the displayed account', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(accountApi.logoutEverywhere(user.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/logout-all', expect.objectContaining({
      method: 'POST', credentials: 'include', body: '{}',
      headers: { 'X-Grim-Client': 'web', 'X-Grim-User': user.id, 'Content-Type': 'application/json' },
    }));
    await expect(accountApi.deleteBackup('id/with?syntax', user.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/backups/id%2Fwith%3Fsyntax', expect.objectContaining({
      method: 'DELETE', credentials: 'include', headers: { 'X-Grim-Client': 'web', 'X-Grim-User': user.id },
    }));
    expect(fetchMock.mock.lastCall?.[1].body).toBeUndefined();
    await expect(accountApi.deleteAccount('my password', user.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/account', expect.objectContaining({
      method: 'DELETE', credentials: 'include', body: JSON.stringify({ password: 'my password' }),
      headers: { 'X-Grim-Client': 'web', 'X-Grim-User': user.id, 'Content-Type': 'application/json' },
    }));
  });

  it('bounds response bodies even when the server omits Content-Length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal('fetch', fetchMock);
    await expect(accountApi.session()).rejects.toMatchObject({ status: 502 });
    expect(cancel).toHaveBeenCalled();
  });
});
