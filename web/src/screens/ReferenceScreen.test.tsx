// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { ReferenceScreen } from './ReferenceScreen';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';

const registry = new ContentRegistry([{
  $schema: 'grimcomp.content.v2',
  id: 'test-rules',
  name: 'Test rules',
  version: '1',
  conditions: [{
    name: 'Surprised',
    description: 'You cannot react until the surprise passes.',
    clearsAtSceneEnd: true,
  }],
}] satisfies ContentPack[]);

beforeEach(async () => prepareStorageTest());

afterEach(async () => {
  cleanup();
  document.body.style.overflow = '';
  await cleanupStorageTest();
});

describe('ReferenceScreen recent history', () => {
  it('browses custom rule categories and roll tables, including saved custom-category history', async () => {
    const expanded = new ContentRegistry([{
      $schema: 'grimcomp.content.v2', id: 'expanded', name: 'Expanded rules', version: '1',
      references: [
        { id: 'alchemy', name: 'Alchemy', category: 'Arcane practice', description: 'Alchemy details.' },
        { id: 'all', name: 'All entry', category: 'All', description: 'Custom All details.' },
      ],
      tables: [{ id: 'omen', name: 'Omens', rows: [{ min: 1, max: 100, effect: 'Read the stars.' }] }],
    }]);
    render(
      <ContentContext.Provider value={expanded}>
        <ReferenceScreen />
      </ContentContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Arcane practice reference' }));
    expect(screen.getByRole('button', { name: 'Arcane practice' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('option', { name: /Alchemy/ }));
    expect(screen.getByText('Alchemy details.')).toBeTruthy();
    await act(async () => { await waitForStorageIdle(); });
    const stored = JSON.parse(localStorage.getItem('gc.reference.recent') || '[]');
    expect(stored[0]).toMatchObject({ name: 'Alchemy', category: 'Arcane practice' });

    fireEvent.click(screen.getByRole('button', { name: 'Roll Tables' }));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('option', { name: /Omens/ }));
    expect(screen.getByText('1–100: Read the stars.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /All entry/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All categories' }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('records entries the user actually opens', async () => {
    render(
      <ContentContext.Provider value={registry}>
        <ReferenceScreen />
      </ContentContext.Provider>,
    );

    expect(screen.getByText('Open a reference entry and it will appear here.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search rules' }));
    fireEvent.click(screen.getByRole('option', { name: /Surprised/ }));
    await act(async () => { await waitForStorageIdle(); });

    const stored = JSON.parse(localStorage.getItem('gc.reference.recent') || '[]') as Array<{ name: string }>;
    expect(stored.map(item => item.name)).toEqual(['Surprised']);
  });

  it('restores the recent list from storage after a remount', () => {
    localStorage.setItem('gc.reference.recent', JSON.stringify([{
      id: 'condition:Surprised',
      name: 'Surprised',
      category: 'Conditions',
      meta: 'Condition',
      detail: 'You cannot react until the surprise passes.',
    }]));
    _resetStoredCache();

    render(
      <ContentContext.Provider value={registry}>
        <ReferenceScreen />
      </ContentContext.Provider>,
    );

    expect(screen.queryByText('Open a reference entry and it will appear here.')).toBeNull();
    expect(screen.getByText('Surprised')).toBeTruthy();
  });
});
