// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPanel } from '../../../src/account/AccountPanel';
import type { AccountSession } from '../../../src/account/client';

const mocked = vi.hoisted(() => ({
  alert: vi.fn(),
  appStateListener: null as ((state: string) => void) | null,
  account: {
    configured: true,
    sessionVersion: 1,
    getSnapshot: vi.fn<() => AccountSession>(),
    subscribe: vi.fn(() => () => undefined),
    restoreSession: vi.fn(),
    authenticate: vi.fn(),
    logout: vi.fn(),
    assertSession: vi.fn(),
    listBackups: vi.fn(),
    saveBackup: vi.fn(),
    getBackup: vi.fn(),
  },
  applyImport: vi.fn(),
  buildExport: vi.fn(),
}));

// Render native account behavior through web host elements; the test config
// resolves react-native even when the separate Expo dependencies are absent.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: { ios?: unknown; default?: unknown }) => options.ios ?? options.default },
  ActivityIndicator: () => null,
  Alert: { alert: mocked.alert },
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocked.appStateListener = listener;
      return { remove: () => { mocked.appStateListener = null; } };
    },
  },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: ({ children, accessibilityRole }: { children: React.ReactNode; accessibilityRole?: string }) => <span role={accessibilityRole}>{children}</span>,
  TextInput: () => <input />,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../src/components/Button', () => ({
  Button: ({ children, disabled, onPress }: { children: React.ReactNode; disabled?: boolean; onPress?: () => void }) => <button disabled={disabled} onClick={onPress}>{children}</button>,
}));
vi.mock('../../../src/components/Card', () => ({ Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../src/hooks/useCharacter', () => ({ useCharacter: () => ({ id: 'c1', template: { name: 'Marta' } }) }));
vi.mock('../../../src/hooks/useRoster', () => ({ useRoster: () => ({ all: { c1: {} } }) }));
vi.mock('../../../src/storage/useNativeStorage', () => ({ useNativeStorageStatus: () => ({ pending: 0, dirty: false, blocked: false }) }));
vi.mock('../../../src/storage/settingsData', () => ({
  applyNativeSettingsImport: mocked.applyImport,
  buildNativeSettingsExport: mocked.buildExport,
  validateNativeSettingsImport: (dump: unknown) => ({ ok: true, dump }),
}));
vi.mock('../../../src/account/runtime', () => ({ nativeAccountClient: mocked.account }));

const USER = { id: 'account-a', name: 'Marta', email: 'marta@example.com' };
const BACKUP = { id: 'backup-a', createdAt: '2026-09-12T10:00:00.000Z', bytes: 100 };
const SNAPSHOT = JSON.stringify({ $schema: 'grimcomp.v1', 'gc.c1.wounds': 4 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function showPanel() {
  const result = render(<AccountPanel />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement).disabled).toBe(false));
  return result;
}

function confirmation() {
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  const buttons = mocked.alert.mock.lastCall?.[2] as { text: string; onPress?: () => void }[];
  return buttons.find(button => button.text === 'Restore')!.onPress!;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.account.sessionVersion = 1;
  mocked.account.getSnapshot.mockReturnValue({ user: USER, initialized: true });
  mocked.account.listBackups.mockResolvedValue([BACKUP]);
  mocked.account.getBackup.mockResolvedValue({ backup: BACKUP, snapshot: SNAPSHOT });
  mocked.account.saveBackup.mockResolvedValue(BACKUP);
  mocked.applyImport.mockResolvedValue({ result: { ok: true }, written: 1 });
  mocked.buildExport.mockResolvedValue(SNAPSHOT);
});
afterEach(cleanup);

describe('native account panel lifecycle', () => {
  it('ignores a restore confirmation after leaving Settings', async () => {
    const panel = await showPanel();
    const confirm = confirmation();
    panel.unmount();
    await act(async () => { confirm(); });
    expect(mocked.account.getBackup).not.toHaveBeenCalled();
    expect(mocked.applyImport).not.toHaveBeenCalled();
  });

  it('discards a downloaded restore after leaving Settings', async () => {
    const pending = deferred<{ backup: typeof BACKUP; snapshot: string }>();
    mocked.account.getBackup.mockReturnValueOnce(pending.promise);
    const panel = await showPanel();
    await act(async () => { confirmation()(); });
    expect(mocked.account.getBackup).toHaveBeenCalledWith(BACKUP.id);
    panel.unmount();
    await act(async () => { pending.resolve({ backup: BACKUP, snapshot: SNAPSHOT }); });
    expect(mocked.applyImport).not.toHaveBeenCalled();
  });

  it('does not upload an export that finishes after leaving Settings', async () => {
    const pending = deferred<string>();
    mocked.buildExport.mockReturnValueOnce(pending.promise);
    const panel = await showPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Save roster backup' }));
    panel.unmount();
    await act(async () => { pending.resolve(SNAPSHOT); });
    expect(mocked.account.saveBackup).not.toHaveBeenCalled();
  });

  it('waits for a confirmed local write before announcing restore success', async () => {
    const pending = deferred<{ result: { ok: true }; written: number }>();
    mocked.applyImport.mockReturnValueOnce(pending.promise);
    await showPanel();
    await act(async () => { confirmation()(); });
    expect(mocked.applyImport).toHaveBeenCalledWith(JSON.parse(SNAPSHOT));
    expect(screen.queryByText(/Backup restored/)).toBeNull();
    await act(async () => { pending.resolve({ result: { ok: true }, written: 1 }); });
    expect(screen.getByText(/Backup restored. 1 saved values/)).toBeTruthy();
  });

  it.each([
    [true, /^Signed out\. Local characters remain/],
    [false, /server could not be reached, so the server session will end when it expires/],
  ])('reports a sign-out whose server confirmation is %s', async (serverConfirmed, message) => {
    mocked.account.logout.mockImplementation(async () => {
      mocked.account.getSnapshot.mockReturnValue({ user: null, initialized: true });
      return { serverConfirmed };
    });
    await showPanel();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); });
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('hides the previous account backups immediately if another account is restored', async () => {
    await showPanel();
    mocked.account.restoreSession.mockImplementationOnce(async () => {
      mocked.account.sessionVersion += 1;
      mocked.account.getSnapshot.mockReturnValue({ user: { ...USER, id: 'account-b' }, initialized: true });
    });
    mocked.account.listBackups.mockRejectedValueOnce(new Error('Connection failed.'));
    await act(async () => {
      mocked.appStateListener?.('background');
      mocked.appStateListener?.('active');
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Connection failed.'));
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    expect(screen.queryByText(new Date(BACKUP.createdAt).toLocaleString())).toBeNull();
  });
});
