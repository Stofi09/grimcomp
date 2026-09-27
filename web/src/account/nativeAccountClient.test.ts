import { describe, expect, it, vi } from 'vitest';
import { MAX_SETTINGS_BACKUP_FILE_BYTES } from '@grimcomp/core';
import { NativeAccountClient } from '../../../src/account/client';

const USER = { id: 'account-a', name: 'Adventurer', email: 'adventurer@example.com' };
const DETAILS = { name: 'Adventurer', email: ' Adventurer@Example.com ', password: 'a-long-account-password' };
const BACKUP = { id: 'backup-a', createdAt: '2026-09-12T10:00:00.000Z', bytes: 100 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function harness(platform: 'native' | 'web' = 'native', savedToken: string | null = null, baseUrl: string | null = 'https://accounts.example.test') {
  let token = savedToken;
  const tokenStore = {
    read: vi.fn(async () => token),
    write: vi.fn(async (next: string) => { token = next; }),
    remove: vi.fn(async () => { token = null; }),
  };
  const fetcher = vi.fn<typeof fetch>();
  const client = new NativeAccountClient({ baseUrl, platform, tokenStore, fetch: fetcher });
  return { client, fetcher, tokenStore, savedToken: () => token };
}

describe('native account client', () => {
  it('registers with normalized email and stores only the issued session token', async () => {
    const h = harness();
    h.fetcher.mockResolvedValue(json({ user: USER, expiresAt: '2026-10-12T10:00:00.000Z', token: 'private-session-token' }));
    await h.client.authenticate('register', DETAILS);

    expect(h.savedToken()).toBe('private-session-token');
    expect(h.tokenStore.write).toHaveBeenCalledWith('private-session-token');
    expect(h.client.getSnapshot()).toEqual({ user: USER, initialized: true });
    expect(h.fetcher).toHaveBeenCalledWith('https://accounts.example.test/api/auth/register', expect.objectContaining({
      credentials: 'omit',
      headers: { 'X-Grim-Client': 'native', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: USER.email, password: DETAILS.password, name: DETAILS.name }),
    }));
  });

  it('restores a SecureStore token as a bearer session and requests private backups', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER })).mockResolvedValueOnce(json({ backups: [BACKUP] }));
    await h.client.restoreSession();
    expect(await h.client.listBackups()).toEqual([BACKUP]);
    for (const [, options] of h.fetcher.mock.calls) {
      expect(options).toMatchObject({ credentials: 'omit', headers: { 'X-Grim-Client': 'native', Authorization: 'Bearer saved-session' } });
    }
    expect(h.fetcher.mock.calls[1][1]?.headers).toMatchObject({ 'X-Grim-User': USER.id });
  });

  it('keeps a persisted token on network failure so retry can restore the session', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockRejectedValueOnce(new TypeError('Network error')).mockResolvedValueOnce(json({ user: USER }));
    await expect(h.client.restoreSession()).rejects.toThrow(/connection/);
    expect(h.savedToken()).toBe('saved-session');
    expect(h.tokenStore.remove).not.toHaveBeenCalled();
    expect(h.client.getSnapshot().user).toBeNull();
    await h.client.restoreSession();
    expect(h.client.getSnapshot().user).toEqual(USER);
  });

  it.each([401, 200])('clears invalid stored sessions for status %s without exposing an account', async (status) => {
    const h = harness('native', 'expired-session');
    h.fetcher.mockResolvedValue(json(status === 401 ? { error: 'Expired' } : { user: null }, status));
    if (status === 401) await expect(h.client.restoreSession()).rejects.toThrow(/expired/);
    else await h.client.restoreSession();
    expect(h.savedToken()).toBeNull();
    expect(h.client.getSnapshot()).toEqual({ user: null, initialized: true });
    await expect(h.client.listBackups()).rejects.toThrow(/account changed/);
  });

  it('does not contact the server for a native session without a saved token', async () => {
    const h = harness();
    await h.client.restoreSession();
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.client.getSnapshot()).toEqual({ user: null, initialized: true });
  });

  it.each(['native', 'web'] as const)('clears stale %s account state on a backup account mismatch', async platform => {
    const h = harness(platform, 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }))
      .mockResolvedValueOnce(json({ error: 'Your account changed in another window.' }, 409));
    await h.client.restoreSession();
    const version = h.client.sessionVersion;
    await expect(h.client.listBackups()).rejects.toThrow(/account changed/);
    expect(h.client.getSnapshot().user).toBeNull();
    expect(() => h.client.assertSession(version)).toThrow(/account changed/);
    if (platform === 'native') expect(h.savedToken()).toBeNull();
    else {
      expect(h.tokenStore.remove).not.toHaveBeenCalled();
      h.fetcher.mockResolvedValueOnce(json({ user: { ...USER, id: 'account-b' } }));
      await h.client.restoreSession();
      expect(h.client.getSnapshot().user?.id).toBe('account-b');
    }
  });

  it('preserves a current session when registration returns an email conflict', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }))
      .mockResolvedValueOnce(json({ error: 'An account with this email already exists.' }, 409));
    await h.client.restoreSession();
    await expect(h.client.authenticate('register', DETAILS)).rejects.toThrow(/already exists/);
    expect(h.client.getSnapshot().user).toEqual(USER);
    expect(h.savedToken()).toBe('saved-session');
  });

  it('uses cookies in Expo web without accessing native token storage', async () => {
    const h = harness('web');
    h.fetcher.mockResolvedValueOnce(json({ user: null }))
      .mockResolvedValueOnce(json({ user: USER, expiresAt: '2026-10-12T10:00:00.000Z' }))
      .mockResolvedValueOnce(json({ backups: [BACKUP] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await h.client.restoreSession();
    await h.client.authenticate('login', DETAILS);
    await h.client.listBackups();
    await h.client.logout();
    expect(h.tokenStore.read).not.toHaveBeenCalled();
    expect(h.tokenStore.write).not.toHaveBeenCalled();
    expect(h.tokenStore.remove).not.toHaveBeenCalled();
    for (const [, options] of h.fetcher.mock.calls) {
      expect(options?.credentials).toBe('include');
      expect(options?.headers).toMatchObject({ 'X-Grim-Client': 'web' });
      expect(options?.headers).not.toHaveProperty('Authorization');
    }
    expect(h.fetcher.mock.calls[2][1]?.headers).toMatchObject({ 'X-Grim-User': USER.id });
  });

  it('identifies the previous native session during reauthentication without clearing it on login failure', async () => {
    const h = harness('native', 'previous-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }))
      .mockResolvedValueOnce(json({ error: 'Invalid email or password.' }, 401))
      .mockResolvedValueOnce(json({ user: USER, token: 'rotated-session' }));
    await h.client.restoreSession();
    await expect(h.client.authenticate('login', DETAILS)).rejects.toThrow(/Invalid email or password/);
    expect(h.savedToken()).toBe('previous-session');
    expect(h.client.getSnapshot().user).toEqual(USER);
    expect(h.tokenStore.remove).not.toHaveBeenCalled();
    await h.client.authenticate('login', DETAILS);
    expect(h.fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer previous-session' });
    expect(h.fetcher.mock.calls[2][1]?.headers).toMatchObject({ Authorization: 'Bearer previous-session' });
    expect(h.savedToken()).toBe('rotated-session');
  });

  it('rejects a declared oversized response and aborts it before reading its body', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }));
    await h.client.restoreSession();
    const response = json({ backups: [] });
    response.headers.set('Content-Length', String(MAX_SETTINGS_BACKUP_FILE_BYTES * 6 + 65_537));
    const read = vi.spyOn(response, 'text');
    h.fetcher.mockResolvedValueOnce(response);
    await expect(h.client.listBackups()).rejects.toThrow(/response is too large/);
    expect(read).not.toHaveBeenCalled();
    expect(h.fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(h.savedToken()).toBe('saved-session');
  });

  it('aborts an undeclared oversized body as soon as the stream crosses the cap', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }));
    await h.client.restoreSession();
    let chunksPulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksPulled += 1;
        controller.enqueue(new Uint8Array(16_384).fill(0x78));
      },
    });
    h.fetcher.mockResolvedValueOnce(new Response(endless, { status: 200 }));

    await expect(h.client.listBackups()).rejects.toThrow(/response is too large/);
    expect(h.fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(chunksPulled).toBeLessThan(12);
    expect(h.client.getSnapshot().user).toEqual(USER);
  });

  it('checks a buffered React Native body size before materializing its text', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }));
    await h.client.restoreSession();
    // React Native's fetch has no body stream; it resolves with a native Blob.
    const buffered = (size: number, text: string) => {
      const readText = vi.fn(async () => text);
      const response = {
        ok: true, status: 200, headers: new Headers(), body: undefined,
        clone: () => ({ blob: async () => ({ size }) }),
        text: readText,
      } as unknown as Response;
      return { response, readText };
    };

    const oversized = buffered(65_537, '{}');
    h.fetcher.mockResolvedValueOnce(oversized.response);
    await expect(h.client.listBackups()).rejects.toThrow(/response is too large/);
    expect(oversized.readText).not.toHaveBeenCalled();
    expect(h.fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);

    const listing = JSON.stringify({ backups: [BACKUP] });
    const small = buffered(listing.length, listing);
    h.fetcher.mockResolvedValueOnce(small.response);
    await expect(h.client.listBackups()).resolves.toEqual([BACKUP]);
  });

  it('signs out locally with the saved token removed when the server cannot be reached', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }))
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    await h.client.restoreSession();
    const version = h.client.sessionVersion;

    await expect(h.client.logout()).resolves.toEqual({ serverConfirmed: false });
    // Revocation was still attempted with the session it should end.
    expect(h.fetcher.mock.calls[1][0]).toBe('https://accounts.example.test/api/auth/logout');
    expect(h.fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer saved-session' });
    expect(h.client.getSnapshot()).toEqual({ user: null, initialized: true });
    expect(h.savedToken()).toBeNull();
    expect(() => h.client.assertSession(version)).toThrow(/account changed/);
  });

  it.each([
    ['a server error', () => json({ error: 'Temporarily unavailable.' }, 503)],
    ['an already-expired session', () => json({ error: 'Expired' }, 401)],
  ])('still signs out locally after %s', async (_label, response) => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER })).mockResolvedValueOnce(response());
    await h.client.restoreSession();

    await expect(h.client.logout()).resolves.toEqual({ serverConfirmed: false });
    expect(h.client.getSnapshot().user).toBeNull();
    expect(h.savedToken()).toBeNull();
  });

  it('confirms a server-side sign-out', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await h.client.restoreSession();

    await expect(h.client.logout()).resolves.toEqual({ serverConfirmed: true });
    expect(h.savedToken()).toBeNull();
  });

  it('reports a saved token that could not be removed while still clearing the session', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await h.client.restoreSession();
    h.tokenStore.remove.mockRejectedValueOnce(new Error('Keychain is unavailable.'));

    await expect(h.client.logout()).rejects.toThrow(/could not be removed/);
    expect(h.client.getSnapshot().user).toBeNull();
    // The pending removal is retried before the next restore reads a token.
    await h.client.restoreSession();
    expect(h.savedToken()).toBeNull();
    expect(h.client.getSnapshot().user).toBeNull();
  });

  it('bounds small metadata responses independently from downloaded snapshots', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }));
    await h.client.restoreSession();
    h.fetcher.mockResolvedValueOnce(json({ backups: [], unexpected: 'x'.repeat(65_536) }));
    await expect(h.client.listBackups()).rejects.toThrow(/response is too large/);
    expect(h.client.getSnapshot().user).toEqual(USER);
  });

  it.each([
    { ...USER, id: '' },
    { ...USER, id: 'x'.repeat(129) },
    { ...USER, name: ' ' },
    { ...USER, name: 'x'.repeat(81) },
    { ...USER, email: 'x'.repeat(255) },
  ])('rejects invalid account metadata before storing credentials: %j', async user => {
    const h = harness();
    h.fetcher.mockResolvedValueOnce(json({ user, token: 'issued-session' }));
    await expect(h.client.authenticate('login', DETAILS)).rejects.toThrow(/invalid user/);
    expect(h.tokenStore.write).not.toHaveBeenCalled();
    expect(h.client.getSnapshot().user).toBeNull();
  });

  it.each([' ', 'unsafe\ntoken', 'x'.repeat(1_025)])('rejects a malformed or oversized sign-in token', async token => {
    const h = harness();
    h.fetcher.mockResolvedValueOnce(json({ user: USER, token }));
    await expect(h.client.authenticate('login', DETAILS)).rejects.toThrow(/valid sign-in token/);
    expect(h.tokenStore.write).not.toHaveBeenCalled();
  });

  it('clears a rotated account when its replacement token cannot be securely persisted', async () => {
    const h = harness('native', 'previous-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }))
      .mockResolvedValueOnce(json({ user: { ...USER, id: 'account-b' }, token: 'rotated-session' }));
    await h.client.restoreSession();
    h.tokenStore.write.mockRejectedValueOnce(new Error('Keychain is unavailable.'));
    await expect(h.client.authenticate('login', DETAILS)).rejects.toThrow(/save your sign-in securely/);
    expect(h.client.getSnapshot().user).toBeNull();
    expect(h.savedToken()).toBeNull();
    await expect(h.client.listBackups()).rejects.toThrow(/account changed/);
  });

  it('retries failed credential cleanup before restoring a partially persisted sign-in', async () => {
    let token: string | null = null;
    const tokenStore = {
      read: vi.fn(async () => token),
      write: vi.fn(async (next: string) => { token = next; throw new Error('Write confirmation failed.'); }),
      remove: vi.fn(async () => { token = null; }),
    };
    tokenStore.remove.mockRejectedValueOnce(new Error('Keychain is unavailable.'))
      .mockRejectedValueOnce(new Error('Keychain is still unavailable.'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ user: USER, token: 'partial-session' }));
    const client = new NativeAccountClient({ baseUrl: 'https://accounts.example.test', platform: 'native', tokenStore, fetch: fetcher });
    await expect(client.authenticate('login', DETAILS)).rejects.toThrow(/save your sign-in securely/);
    expect(token).toBe('partial-session');
    await expect(client.restoreSession()).rejects.toThrow(/still unavailable/);
    expect(tokenStore.read).not.toHaveBeenCalled();
    expect(client.getSnapshot().user).toBeNull();
    await client.restoreSession();
    expect(token).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot().user).toBeNull();
  });

  it('serializes token cleanup after an in-flight secure write when the session is invalidated', async () => {
    let token: string | null = 'previous-session';
    let finishWrite!: () => void;
    let startedWrite!: () => void;
    const writing = new Promise<void>(resolve => { startedWrite = resolve; });
    const fetcher = vi.fn<typeof fetch>();
    const client = new NativeAccountClient({
      baseUrl: 'https://accounts.example.test', platform: 'native', fetch: fetcher,
      tokenStore: {
        read: async () => token,
        write: async next => {
          startedWrite();
          await new Promise<void>(resolve => { finishWrite = resolve; });
          token = next;
        },
        remove: async () => { token = null; },
      },
    });
    fetcher.mockResolvedValueOnce(json({ user: USER }));
    await client.restoreSession();
    let finishBackups!: (response: Response) => void;
    fetcher.mockReturnValueOnce(new Promise<Response>(resolve => { finishBackups = resolve; }))
      .mockResolvedValueOnce(json({ user: USER, token: 'rotated-session' }));
    const backupRequest = client.listBackups();
    const expired = expect(backupRequest).rejects.toThrow(/expired/);
    const login = client.authenticate('login', DETAILS);
    const changed = expect(login).rejects.toThrow(/account changed/);
    await writing;
    finishBackups(json({ error: 'Session expired' }, 401));
    // The response invalidates the session before the secure write completes.
    await vi.waitFor(() => expect(client.getSnapshot().user).toBeNull());
    finishWrite();
    await Promise.all([expired, changed]);
    expect(token).toBeNull();
    expect(client.getSnapshot().user).toBeNull();
  });

  it('prevents a duplicate login while the first request is in flight', async () => {
    const h = harness();
    let resolve!: (response: Response) => void;
    h.fetcher.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const first = h.client.authenticate('login', DETAILS);
    await expect(h.client.authenticate('login', DETAILS)).rejects.toThrow(/already in progress/);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    resolve(json({ user: USER, token: 'new-session' }));
    await first;
    expect(h.savedToken()).toBe('new-session');
  });

  it('rejects a backup response that arrives after sign out', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }));
    await h.client.restoreSession();
    let resolve!: (response: Response) => void;
    h.fetcher.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const pending = h.client.getBackup(BACKUP.id);
    const rejected = expect(pending).rejects.toThrow(/account changed/);
    await h.client.logout();
    resolve(json({ backup: BACKUP, snapshot: '{"$schema":"grimcomp.v1","gc.c1.wounds":5}' }));
    await rejected;
    expect(h.savedToken()).toBeNull();
    expect(h.client.getSnapshot().user).toBeNull();
  });

  it('invalidates pending backup work when web session revalidation detects another account', async () => {
    const h = harness('web');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }));
    await h.client.restoreSession();
    let resolve!: (response: Response) => void;
    h.fetcher.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }))
      .mockResolvedValueOnce(json({ user: { ...USER, id: 'account-b' } }));
    const pending = h.client.getBackup(BACKUP.id);
    const rejected = expect(pending).rejects.toThrow(/account changed/);
    await h.client.restoreSession();
    resolve(json({ backup: BACKUP, snapshot: '{"$schema":"grimcomp.v1","gc.c1.wounds":5}' }));
    await rejected;
    expect(h.client.getSnapshot().user?.id).toBe('account-b');
  });

  it('does not send oversized snapshots or accept mismatched backup identities', async () => {
    const h = harness('native', 'saved-session');
    h.fetcher.mockResolvedValueOnce(json({ user: USER }));
    await h.client.restoreSession();
    await expect(h.client.saveBackup('x'.repeat(MAX_SETTINGS_BACKUP_FILE_BYTES + 1))).rejects.toThrow(/960 KiB/);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.fetcher.mockResolvedValueOnce(json({ backup: { ...BACKUP, id: 'another-backup' }, snapshot: '{}' }));
    await expect(h.client.getBackup(BACKUP.id)).rejects.toThrow(/different backup/);
  });

  it('rejects invalid registration details before network requests', async () => {
    const h = harness();
    await expect(h.client.authenticate('register', { ...DETAILS, password: 'short' })).rejects.toThrow(/12 and 128/);
    await expect(h.client.authenticate('register', { ...DETAILS, email: 'invalid' })).rejects.toThrow(/email/);
    await expect(h.client.authenticate('register', { ...DETAILS, name: ' ' })).rejects.toThrow(/name/);
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('leaves offline gameplay independent when account configuration is unavailable', async () => {
    const h = harness('native', null, null);
    await h.client.restoreSession();
    expect(h.client.configured).toBe(false);
    expect(h.client.getSnapshot()).toEqual({ user: null, initialized: true });
    await expect(h.client.authenticate('login', DETAILS)).rejects.toThrow(/not been configured/);
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.tokenStore.read).not.toHaveBeenCalled();
  });
});
