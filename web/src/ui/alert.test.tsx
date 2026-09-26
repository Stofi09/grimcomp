// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { EditSheet } from '@/components/EditSheet';
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
  it('keeps focus in a result replacing a form, then returns it to the original trigger', async () => {
    const reopened = vi.fn();
    function Flow() {
      const [open, setOpen] = useState(false);
      return <>
        <AlertHost />
        <button onClick={() => { reopened(); setOpen(true); }}>Take a hit</button>
        <EditSheet visible={open} title="Damage" onClose={() => setOpen(false)} onSave={async () => {
          await Promise.resolve();
          setOpen(false);
          Alert.alert('Damage applied');
        }}><input aria-label="Damage amount" /></EditSheet>
      </>;
    }
    render(<Flow />);
    const trigger = screen.getByRole('button', { name: 'Take a hit' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const result = await screen.findByRole('alertdialog');
    await waitFor(() => expect(document.activeElement).toBe(result));
    trigger.focus(); // Even a background focus restoration must be contained.
    expect(document.activeElement).toBe(result);
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(reopened).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.body.style.overflow).toBe('');
  });
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
