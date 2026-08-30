// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import { TrappingsScreen } from './TrappingsScreen';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';

beforeEach(async () => prepareStorageTest());

afterEach(async () => {
  cleanup();
  document.body.style.overflow = '';
  await cleanupStorageTest();
});

describe('TrappingsScreen wealth', () => {
  it('edits and persists the active character\'s configured denominations', async () => {
    render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <TrappingsScreen />
      </ContentContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit wealth' }));
    fireEvent.change(screen.getByLabelText('GC'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('SS'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => { await waitForStorageIdle(); });

    expect(JSON.parse(localStorage.getItem('gc.c1.wealth') || '{}')).toMatchObject({
      gc: 4,
      ss: 7,
      d: 0,
    });
  });
});
