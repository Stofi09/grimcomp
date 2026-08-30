// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { ReferenceSearchSheet } from './ReferenceSearchSheet';

const registry = new ContentRegistry([{
  $schema: 'grimcomp.content.v2',
  id: 'test-rules',
  name: 'Test rules',
  version: '1',
  conditions: [
    { name: 'Bleeding', description: 'Lose blood.' },
    { name: 'Fatigued', description: 'Lose energy.' },
    { name: 'Stunned', description: 'Lose actions.' },
  ],
}] satisfies ContentPack[]);

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

const renderSheet = (onViewed = vi.fn()) => {
  render(
    <ContentContext.Provider value={registry}>
      <ReferenceSearchSheet visible onClose={vi.fn()} onViewed={onViewed} />
    </ContentContext.Provider>,
  );
  return onViewed;
};

const activeOption = (listbox: HTMLElement): HTMLElement | null => {
  const activeId = listbox.getAttribute('aria-activedescendant');
  return activeId ? document.getElementById(activeId) : null;
};

describe('ReferenceSearchSheet listbox', () => {
  it('uses one tab stop and selects the active option from the keyboard', () => {
    const onViewed = renderSheet();
    const listbox = screen.getByRole('listbox', { name: 'Reference results' });
    const options = screen.getAllByRole('option');

    expect(listbox.tabIndex).toBe(0);
    expect(options.every(option => option.tabIndex === -1)).toBe(true);

    listbox.focus();
    expect(document.activeElement).toBe(listbox);
    expect(activeOption(listbox)).toBe(options[0]);

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(activeOption(listbox)).toBe(options[1]);
    expect(options.every(option => option.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(onViewed).not.toHaveBeenCalled();

    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(onViewed).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fatigued' }));
    expect(document.activeElement).toBe(listbox);
  });

  it('supports Home, End, and Space while preserving selection until activation', () => {
    renderSheet();
    const listbox = screen.getByRole('listbox', { name: 'Reference results' });
    const options = screen.getAllByRole('option');

    listbox.focus();
    fireEvent.keyDown(listbox, { key: 'End' });
    expect(activeOption(listbox)).toBe(options[2]);
    fireEvent.keyDown(listbox, { key: ' ' });
    expect(options[2].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(activeOption(listbox)).toBe(options[0]);
    expect(options[2].getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the active descendant valid after filtering and restores focus after a click', () => {
    renderSheet();
    const search = screen.getByRole('textbox', { name: 'Search' });
    fireEvent.change(search, { target: { value: 'Stunned' } });

    const listbox = screen.getByRole('listbox', { name: 'Reference results' });
    const onlyOption = screen.getByRole('option', { name: /Stunned/ });
    expect(activeOption(listbox)).toBe(onlyOption);

    fireEvent.change(search, { target: { value: '' } });
    const options = screen.getAllByRole('option');
    fireEvent.click(options[1]);
    expect(document.activeElement).toBe(listbox);
    expect(activeOption(listbox)).toBe(options[1]);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
  });
});
