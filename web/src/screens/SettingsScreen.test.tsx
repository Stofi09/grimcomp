// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { buildSettingsExport } from '@/utils/settingsExport';
import {
  cleanupStorageTest,
  prepareStorageTest,
} from '@/test/storageTestUtils';
import charactersPack from '../../public/content/core-characters.json';
import { MAX_SETTINGS_IMPORT_FILE_BYTES, SettingsScreen } from './SettingsScreen';

const validCustomCharacter = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...(charactersPack.characters[0] as unknown as Record<string, unknown>),
  id,
  name: `Custom ${id}`,
  ...overrides,
});

function drainAlerts(): void {
  while (getCurrentAlert() !== null) closeCurrentAlert();
}

beforeEach(async () => {
  await prepareStorageTest();
});

afterEach(async () => {
  cleanup();
  drainAlerts();
  await cleanupStorageTest();
  document.body.style.overflow = '';
});

describe('SettingsScreen exports', () => {
  it('keeps a single-character export scoped and excludes unrelated global notes', async () => {
    const c9 = validCustomCharacter('c9', { name: 'Marta Keller' });
    const c2 = validCustomCharacter('c2');
    localStorage.setItem('gc.activeCharId', JSON.stringify('c9'));
    localStorage.setItem('gc.c9.wounds', JSON.stringify(7));
    localStorage.setItem('gc.c2.wounds', JSON.stringify(3));
    localStorage.setItem('gc.notes', JSON.stringify([{ title: 'Campaign secret' }]));
    localStorage.setItem('gc.notes.filter', JSON.stringify('House'));
    localStorage.setItem('gc.customChars', JSON.stringify({
      c9,
      c2,
    }));

    const parsed = JSON.parse(await buildSettingsExport(
      'character',
      'c9',
      'Marta Keller',
      { bundledContentPacks: [] },
    )) as Record<string, unknown>;

    expect(parsed['gc.c9.wounds']).toBe(7);
    expect(parsed['gc.c2.wounds']).toBeUndefined();
    expect(parsed['gc.notes']).toBeUndefined();
    expect(parsed['gc.notes.filter']).toBeUndefined();
    expect(parsed['gc.customChars']).toEqual({ c9 });
  });
});

describe('SettingsScreen import files', () => {
  it.each([
    ['content-pack', 0],
    ['character', 1],
  ] as const)('rejects an oversized %s file before reading it', (_kind, inputIndex) => {
    const { container } = render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <SettingsScreen />
      </ContentContext.Provider>,
    );
    const text = vi.fn().mockResolvedValue('{}');
    const file = {
      name: 'oversized.json',
      size: MAX_SETTINGS_IMPORT_FILE_BYTES + 1,
      text,
    } as unknown as File;
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');

    fireEvent.change(inputs[inputIndex]!, { target: { files: [file] } });

    expect(text).not.toHaveBeenCalled();
    expect(getCurrentAlert()).toMatchObject({
      title: 'Import too large',
      message: expect.stringContaining('4 MiB import limit'),
    });
  });
});

describe('SettingsScreen reset copy', () => {
  it('explains that reset preserves the internal storage-format marker', () => {
    render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <SettingsScreen />
      </ContentContext.Provider>,
    );

    expect(screen.getByText(/preserves the internal storage-format marker/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wipe' }));
    expect(getCurrentAlert()?.message).toMatch(/storage-format marker remain/i);
  });
});

describe('SettingsScreen content-pack paste', () => {
  it('keeps the sheet open and preserves invalid pasted JSON for correction', () => {
    render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <SettingsScreen />
      </ContentContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Paste JSON' }));
    const input = screen.getByRole('textbox', { name: 'Content pack JSON' });
    fireEvent.change(input, { target: { value: '{ invalid JSON' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    expect(screen.getByRole('dialog', { name: 'Paste content pack JSON' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Content pack JSON' }) as HTMLTextAreaElement).value)
      .toBe('{ invalid JSON');
    expect(getCurrentAlert()?.title).toBe('Invalid JSON');
  });
});

describe('SettingsScreen XP rule', () => {
  it('announces which rule mode is selected after durable persistence', async () => {
    render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <SettingsScreen />
      </ContentContext.Provider>,
    );

    const strict = screen.getByRole('button', { name: 'Strict' });
    const flexible = screen.getByRole('button', { name: 'Flexible' });
    expect(strict.getAttribute('aria-pressed')).toBe('true');
    expect(flexible.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(flexible);

    await waitFor(() => {
      expect(strict.getAttribute('aria-pressed')).toBe('false');
      expect(flexible.getAttribute('aria-pressed')).toBe('true');
    });
  });
});
