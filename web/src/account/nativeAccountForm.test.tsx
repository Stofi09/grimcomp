// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPanel } from '../../../src/account/AccountPanel';
import type { AccountSession } from '../../../src/account/client';

const mocked = vi.hoisted(() => ({
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
}));

type HostProps = Record<string, unknown> & { children?: React.ReactNode };

// TextInput forwards its ref to a DOM input, and Enter stands in for the
// keyboard's Return key so focus chaining can be exercised.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: { ios?: unknown; default?: unknown }) => options.ios ?? options.default },
  ActivityIndicator: () => null,
  Alert: { alert: vi.fn() },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: ({ children }: HostProps) => <span>{children}</span>,
  View: ({ children }: HostProps) => <div>{children}</div>,
  TextInput: React.forwardRef<HTMLInputElement, HostProps>(function TextInput(
    { accessibilityLabel, value, onChangeText, onSubmitEditing, returnKeyType },
    ref,
  ) {
    return (
      <input
        ref={ref}
        aria-label={accessibilityLabel as string | undefined}
        data-return-key={returnKeyType as string | undefined}
        value={value as string}
        onChange={event => (onChangeText as (text: string) => void)(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') (onSubmitEditing as (() => void) | undefined)?.();
        }}
      />
    );
  }),
}));
vi.mock('../../../src/components/Button', () => ({
  Button: ({ children, disabled, onPress }: { children: React.ReactNode; disabled?: boolean; onPress?: () => void }) => (
    <button disabled={disabled} onClick={onPress}>{children}</button>
  ),
}));
vi.mock('../../../src/components/Card', () => ({ Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../src/hooks/useCharacter', () => ({ useCharacter: () => ({ id: 'c1', template: { name: 'Marta' } }) }));
vi.mock('../../../src/hooks/useRoster', () => ({ useRoster: () => ({ all: { c1: {} } }) }));
vi.mock('../../../src/storage/useNativeStorage', () => ({ useNativeStorageStatus: () => ({ pending: 0, dirty: false, blocked: false }) }));
vi.mock('../../../src/storage/settingsData', () => ({
  applyNativeSettingsImport: vi.fn(),
  buildNativeSettingsExport: vi.fn(),
  validateNativeSettingsImport: (dump: unknown) => ({ ok: true, dump }),
}));
vi.mock('../../../src/account/runtime', () => ({ nativeAccountClient: mocked.account }));

beforeEach(() => {
  vi.resetAllMocks();
  mocked.account.getSnapshot.mockReturnValue({ user: null, initialized: true });
  mocked.account.restoreSession.mockResolvedValue(undefined);
  mocked.account.subscribe.mockReturnValue(() => undefined);
});
afterEach(cleanup);

async function showSignedOutForm() {
  render(<AccountPanel />);
  // The mount-time session check briefly disables the form.
  await waitFor(() => expect(
    (screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled,
  ).toBe(false));
}

describe('native account form keyboard flow', () => {
  it('moves from email to password on Return and submits from the password field', async () => {
    mocked.account.authenticate.mockResolvedValue(undefined);
    mocked.account.listBackups.mockResolvedValue([]);
    await showSignedOutForm();
    const email = screen.getByLabelText('Account email');
    const password = screen.getByLabelText('Account password');

    expect(email.getAttribute('data-return-key')).toBe('next');
    expect(password.getAttribute('data-return-key')).toBe('go');
    email.focus();
    fireEvent.keyDown(email, { key: 'Enter' });
    expect(document.activeElement).toBe(password);

    fireEvent.change(email, { target: { value: 'marta@example.com' } });
    fireEvent.change(password, { target: { value: 'a-long-account-password' } });
    await act(async () => { fireEvent.keyDown(password, { key: 'Enter' }); });
    expect(mocked.account.authenticate).toHaveBeenCalledWith('login', expect.objectContaining({
      email: 'marta@example.com', password: 'a-long-account-password',
    }));
  });

  it('moves from name to email when creating an account', async () => {
    await showSignedOutForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const name = screen.getByLabelText('Account name');

    expect(name.getAttribute('data-return-key')).toBe('next');
    name.focus();
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('Account email'));
  });
});
