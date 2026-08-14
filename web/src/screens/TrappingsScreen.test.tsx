// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { TrappingsScreen } from './TrappingsScreen';

afterEach(() => {
  cleanup();
  localStorage.clear();
  _resetStoredCache();
  document.body.style.overflow = '';
});

describe('TrappingsScreen wealth', () => {
  it('edits and persists the active character\'s configured denominations', () => {
    render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <TrappingsScreen />
      </ContentContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit wealth' }));
    fireEvent.change(screen.getByLabelText('GC'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('SS'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(JSON.parse(localStorage.getItem('gc.c1.wealth') || '{}')).toMatchObject({
      gc: 4,
      ss: 7,
      d: 0,
    });
  });
});
