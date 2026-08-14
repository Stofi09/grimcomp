// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { AlertHost } from './alert';
import {
  Alert,
  closeCurrentAlert,
  getCurrentAlert,
} from './alertStore';

function drainAlerts(): void {
  while (getCurrentAlert() !== null) closeCurrentAlert();
}

afterEach(() => {
  cleanup();
  drainAlerts();
  document.body.style.overflow = '';
});

describe('AlertHost', () => {
  it('preserves focus and displays an alert queued by a button callback', async () => {
    render(
      <>
        <button
          type="button"
          onClick={() => Alert.alert('First alert', 'Choose the next step.', [
            {
              text: 'Continue',
              onPress: () => Alert.alert('Follow-up'),
            },
          ])}
        >
          Open alert
        </button>
        <AlertHost />
      </>,
    );

    const trigger = screen.getByRole('button', { name: 'Open alert' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('alertdialog', { name: 'First alert' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alertdialog', { name: 'Follow-up' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
    expect(document.body.style.overflow).toBe('');
  });

  it('uses the cancel action when Escape dismisses a choice alert', () => {
    const onCancel = vi.fn();
    render(
      <>
        <button
          type="button"
          onClick={() => Alert.alert('Delete character', undefined, [
            { text: 'Cancel', style: 'cancel', onPress: onCancel },
            { text: 'Delete', style: 'destructive' },
          ])}
        >
          Delete
        </button>
        <AlertHost />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
