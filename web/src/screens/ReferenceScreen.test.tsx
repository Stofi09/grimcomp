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
