// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { accountApi, AccountApiError } from './api';
import { applySettingsImport, buildSettingsExport } from '@/utils/settingsExport';
import { AccountPanel } from './AccountPanel';

vi.mock('./api', async importOriginal => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    accountApi: {
      session: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(),
      listBackups: vi.fn(), saveBackup: vi.fn(), getBackup: vi.fn(),
    },
  };
});
vi.mock('@/utils/settingsExport', () => ({ buildSettingsExport: vi.fn(), applySettingsImport: vi.fn() }));
vi.mock('@/hooks/useCharacter', () => ({ useCharacter: () => ({ id: 'c1', template: { name: 'Marta' } }) }));
vi.mock('@/content/useContent', () => {
  const content = { allCharacterTemplates: [{ id: 'c1' }], bundledPacks: [{ id: 'core-characters' }] };
  return { useContent: () => content };
});

const user = { id: 'user-1', name: 'Marta Keller', email: 'marta@example.com' };
const session = { user, expiresAt: '2026-10-01T00:00:00.000Z' };
const backup = { id: 'backup-1', createdAt: '2026-09-12T12:00:00.000Z', bytes: 123 };
const snapshot = JSON.stringify({ $schema: 'grimcomp.v1', 'gc.c1.wounds': 4 });

function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function showPanel(signedIn = false) {
  vi.mocked(accountApi.session).mockResolvedValue(signedIn ? session : { user: null });
  render(<AccountPanel />);
  await waitFor(() => expect(screen.queryByText('Checking your session…')).toBeNull());
  if (signedIn) await waitFor(() => expect(screen.queryByText('Loading backups…')).toBeNull());
}

function fillLogin(password = 'correct horse battery') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

function clickRestore() {
  fireEvent.click(screen.getByRole('button', { name: /^Restore backup from/ }));
  const confirmation = getCurrentAlert();
  expect(confirmation?.title).toBe('Restore account backup?');
  const restore = confirmation?.buttons?.find(button => button.text === 'Restore')?.onPress;
  closeCurrentAlert();
  act(() => { restore?.(); });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(accountApi.session).mockResolvedValue({ user: null });
  vi.mocked(accountApi.login).mockResolvedValue(session);
  vi.mocked(accountApi.register).mockResolvedValue(session);
  vi.mocked(accountApi.logout).mockResolvedValue(undefined);
  vi.mocked(accountApi.listBackups).mockResolvedValue([]);
  vi.mocked(accountApi.saveBackup).mockResolvedValue(backup);
  vi.mocked(accountApi.getBackup).mockResolvedValue({ backup, snapshot });
  vi.mocked(buildSettingsExport).mockResolvedValue(snapshot);
  localStorage.setItem('gc.c1.wounds', '9');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  while (getCurrentAlert()) closeCurrentAlert();
});

describe('account forms and sessions', () => {
  it('validates registration and blocks repeated submits until the request finishes', async () => {
    await showPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Marta Keller ' } });
    fillLogin('short');
    fireEvent.submit(screen.getByRole('form', { name: 'Create account' }));
    expect(screen.getByRole('alert').textContent).toContain('between 12 and 128');
    expect(accountApi.register).not.toHaveBeenCalled();

    const pending = deferred<typeof session>();
    vi.mocked(accountApi.register).mockReturnValueOnce(pending.promise);
    fillLogin();
    const form = screen.getByRole('form', { name: 'Create account' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(accountApi.register).toHaveBeenCalledTimes(1);
    expect(accountApi.register).toHaveBeenCalledWith('Marta Keller', user.email, 'correct horse battery');
    expect((screen.getByRole('button', { name: 'Creating account…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pending.resolve(session); });
    expect(screen.getByText(user.email)).toBeTruthy();
    expect(accountApi.saveBackup).not.toHaveBeenCalled();
    expect(localStorage.getItem('gc.c1.wounds')).toBe('9');
  });

  it('shows a rejected login and permits a corrected retry', async () => {
    await showPanel();
    vi.mocked(accountApi.login).mockRejectedValueOnce(new AccountApiError('Invalid email or password.', 401));
    fillLogin('wrong password');
    fireEvent.submit(screen.getByRole('form', { name: 'Log in' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid email or password.'));
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
    fillLogin();
    fireEvent.submit(screen.getByRole('form', { name: 'Log in' }));
    await waitFor(() => expect(screen.getByText(user.email)).toBeTruthy());
  });

  it('recovers an unavailable session check on focus without modifying local data', async () => {
    vi.mocked(accountApi.session).mockRejectedValueOnce(new AccountApiError('Cannot reach the account service.', 0));
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Cannot reach'));
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
    vi.mocked(accountApi.session).mockResolvedValueOnce(session);
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByText(user.email)).toBeTruthy());
    expect(localStorage.getItem('gc.c1.wounds')).toBe('9');
    expect(accountApi.saveBackup).not.toHaveBeenCalled();
    expect(accountApi.getBackup).not.toHaveBeenCalled();
  });

  it('preserves the account on failed logout and clears only the session on success', async () => {
    await showPanel(true);
    vi.mocked(accountApi.logout).mockRejectedValueOnce(new AccountApiError('Network is unavailable.', 0));
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Network is unavailable.'));
    expect(screen.getByText(user.email)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.getByRole('form', { name: 'Log in' })).toBeTruthy());
    expect(localStorage.getItem('gc.c1.wounds')).toBe('9');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('clears an expired account when a backup request returns 401', async () => {
    vi.mocked(accountApi.listBackups).mockRejectedValueOnce(new AccountApiError('Session expired.', 401));
    await showPanel(true);
    await waitFor(() => expect(screen.getByRole('form', { name: 'Log in' })).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Session expired.');
    expect(localStorage.getItem('gc.c1.wounds')).toBe('9');
  });

  it('retries a failed backup list when focus confirms the same account', async () => {
    vi.mocked(accountApi.listBackups).mockRejectedValueOnce(new AccountApiError('Backups are unavailable.', 0));
    await showPanel(true);
    expect(screen.getByRole('alert').textContent).toContain('Backups are unavailable.');
    vi.mocked(accountApi.listBackups).mockResolvedValueOnce([backup]);
    fireEvent.focus(window);
    await waitFor(() => expect(accountApi.listBackups).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores an old backup-list failure while a newer session check is pending', async () => {
    const staleList = deferred<typeof backup[]>();
    const freshSession = deferred<typeof session>();
    vi.mocked(accountApi.session).mockResolvedValueOnce(session).mockReturnValueOnce(freshSession.promise);
    vi.mocked(accountApi.listBackups).mockReturnValueOnce(staleList.promise).mockResolvedValueOnce([backup]);
    render(<AccountPanel />);
    await waitFor(() => expect(accountApi.listBackups).toHaveBeenCalledTimes(1));
    fireEvent.focus(window);
    await act(async () => { staleList.reject(new AccountApiError('Old session expired.', 401)); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(user.email)).toBeTruthy();
    await act(async () => { freshSession.resolve(session); });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeTruthy());
    expect(screen.queryByText('Checking your session…')).toBeNull();
    expect(screen.queryByText('Loading backups…')).toBeNull();
  });

  it('keeps the refreshed backup list when an older list response arrives late', async () => {
    const staleList = deferred<typeof backup[]>();
    vi.mocked(accountApi.session).mockResolvedValue(session);
    vi.mocked(accountApi.listBackups).mockReturnValueOnce(staleList.promise).mockResolvedValueOnce([backup]);
    render(<AccountPanel />);
    await waitFor(() => expect(accountApi.listBackups).toHaveBeenCalledTimes(1));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeTruthy());
    await act(async () => { staleList.resolve([]); });
    expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeTruthy();
    expect(screen.queryByText('No account backups yet.')).toBeNull();
  });

  it('releases a superseded list spinner after a failed session check and permits retry', async () => {
    const staleList = deferred<typeof backup[]>();
    vi.mocked(accountApi.session).mockResolvedValue(session)
      .mockResolvedValueOnce(session)
      .mockRejectedValueOnce(new AccountApiError('Connection lost.', 0));
    vi.mocked(accountApi.listBackups).mockReturnValueOnce(staleList.promise).mockResolvedValueOnce([backup]);
    render(<AccountPanel />);
    await waitFor(() => expect(accountApi.listBackups).toHaveBeenCalledTimes(1));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Connection lost.'));
    expect(screen.queryByText('Checking your session…')).toBeNull();
    expect(screen.queryByText('Loading backups…')).toBeNull();
    await act(async () => { staleList.resolve([]); });
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeTruthy());
    expect(accountApi.session).toHaveBeenCalledTimes(3);
    expect(accountApi.listBackups).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('explicit account backups', () => {
  it('exports and uploads only when requested, using the content validation context', async () => {
    await showPanel(true);
    expect(buildSettingsExport).not.toHaveBeenCalled();
    const pending = deferred<typeof backup>();
    vi.mocked(accountApi.saveBackup).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save backup' }));
    await waitFor(() => expect(accountApi.saveBackup).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Saving backup…' }));
    expect(accountApi.saveBackup).toHaveBeenCalledTimes(1);
    expect(buildSettingsExport).toHaveBeenCalledWith('roster', 'c1', 'Marta', {
      builtInCharacterIds: new Set(['c1']), bundledContentPacks: [{ id: 'core-characters' }],
    });
    expect(accountApi.saveBackup).toHaveBeenCalledWith(snapshot, user.id);
    await act(async () => { pending.resolve(backup); });
    expect(screen.getByText(/Backup saved to your account/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeTruthy();
  });

  it('does not upload an empty fresh roster that cannot be restored', async () => {
    vi.mocked(buildSettingsExport).mockResolvedValueOnce('{"$schema":"grimcomp.v1","scope":"roster"}');
    await showPanel(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save backup' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Make a local change first'));
    expect(accountApi.saveBackup).not.toHaveBeenCalled();
    expect(localStorage.getItem('gc.c1.wounds')).toBe('9');
  });

  it('requires confirmation and waits for durable import completion before reporting restore success', async () => {
    vi.mocked(accountApi.listBackups).mockResolvedValueOnce([backup]);
    const completion = deferred<{ ok: true }>();
    vi.mocked(applySettingsImport).mockReturnValueOnce({
      value: { requested: 1, keys: ['gc.c1.wounds'] }, completion: completion.promise,
    } as ReturnType<typeof applySettingsImport>);
    await showPanel(true);
    fireEvent.click(screen.getByRole('button', { name: /^Restore backup from/ }));
    expect(getCurrentAlert()?.message).toContain('merges custom characters');
    expect(accountApi.getBackup).not.toHaveBeenCalled();
    closeCurrentAlert();
    clickRestore();
    await waitFor(() => expect(applySettingsImport).toHaveBeenCalledWith(JSON.parse(snapshot), {
      builtInCharacterIds: new Set(['c1']), bundledContentPacks: [{ id: 'core-characters' }],
    }));
    expect(getCurrentAlert()).toBeNull();
    expect(screen.queryByText(/Backup restored and saved/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Log out' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { completion.resolve({ ok: true }); });
    expect(getCurrentAlert()?.title).toBe('Backup restored');
    expect(getCurrentAlert()?.message).toContain('1 keys saved durably');
  });

  it('reports failed durability without claiming the backup was restored', async () => {
    vi.mocked(accountApi.listBackups).mockResolvedValueOnce([backup]);
    vi.mocked(applySettingsImport).mockReturnValueOnce({
      value: { requested: 1, keys: ['gc.c1.wounds'] },
      completion: Promise.resolve({ ok: false, outcome: 'blocked', error: new Error('Storage is blocked.') }),
    } as ReturnType<typeof applySettingsImport>);
    await showPanel(true);
    clickRestore();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Restore was not reported complete'));
    expect(getCurrentAlert()).toBeNull();
    expect(screen.queryByText(/Backup restored and saved/)).toBeNull();
  });

  it('rejects an invalid remote snapshot before starting a local import', async () => {
    vi.mocked(accountApi.listBackups).mockResolvedValueOnce([backup]);
    vi.mocked(accountApi.getBackup).mockResolvedValueOnce({ backup, snapshot: '{"$schema":"wrong"}' });
    await showPanel(true);
    clickRestore();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not a supported Grim Companion export'));
    expect(applySettingsImport).not.toHaveBeenCalled();
  });

  it('rejects a backup save when another tab has changed the cookie account', async () => {
    vi.mocked(accountApi.saveBackup).mockRejectedValueOnce(new AccountApiError('Your account changed. Refresh and try again.', 409));
    await showPanel(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save backup' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Your account changed'));
    expect(accountApi.saveBackup).toHaveBeenCalledWith(snapshot, user.id);
    expect(screen.getByRole('form', { name: 'Log in' })).toBeTruthy();
    expect(screen.queryByText(/Backup saved to your account/)).toBeNull();
  });

  it('does not import data when the cookie account changes during a restore', async () => {
    vi.mocked(accountApi.listBackups).mockResolvedValueOnce([backup]);
    vi.mocked(accountApi.getBackup).mockRejectedValueOnce(new AccountApiError('Your account changed. Refresh and try again.', 409));
    await showPanel(true);
    clickRestore();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Your account changed'));
    expect(accountApi.getBackup).toHaveBeenCalledWith(backup.id, user.id);
    expect(applySettingsImport).not.toHaveBeenCalled();
  });

  it('does not start a delayed restore after leaving Settings', async () => {
    vi.mocked(accountApi.listBackups).mockResolvedValueOnce([backup]);
    const pending = deferred<{ backup: typeof backup; snapshot: string }>();
    vi.mocked(accountApi.getBackup).mockReturnValueOnce(pending.promise);
    await showPanel(true);
    clickRestore();
    cleanup();
    await act(async () => { pending.resolve({ backup, snapshot }); });
    expect(applySettingsImport).not.toHaveBeenCalled();
  });

  it('does not restore from a confirmation left open after logging out', async () => {
    vi.mocked(accountApi.listBackups).mockResolvedValueOnce([backup]);
    await showPanel(true);
    fireEvent.click(screen.getByRole('button', { name: /^Restore backup from/ }));
    const confirm = getCurrentAlert()?.buttons?.find(button => button.text === 'Restore')?.onPress;
    closeCurrentAlert();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.getByRole('form', { name: 'Log in' })).toBeTruthy());
    act(() => { confirm?.(); });
    expect(accountApi.getBackup).not.toHaveBeenCalled();
    expect(applySettingsImport).not.toHaveBeenCalled();
  });

  it('does not reuse a restore confirmation after logging back into the same account', async () => {
    vi.mocked(accountApi.listBackups).mockResolvedValue([backup]);
    await showPanel(true);
    fireEvent.click(screen.getByRole('button', { name: /^Restore backup from/ }));
    const confirm = getCurrentAlert()?.buttons?.find(button => button.text === 'Restore')?.onPress;
    closeCurrentAlert();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.getByRole('form', { name: 'Log in' })).toBeTruthy());
    fillLogin();
    fireEvent.submit(screen.getByRole('form', { name: 'Log in' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeTruthy());
    act(() => { confirm?.(); });
    expect(accountApi.getBackup).not.toHaveBeenCalled();
    expect(applySettingsImport).not.toHaveBeenCalled();
  });
});
