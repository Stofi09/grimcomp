// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { Shell } from './Shell';

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  _resetStoredCache();
  document.body.style.overflow = '';
  setViewportWidth(1024);
});

describe('mobile navigation drawer', () => {
  it('traps the page, locks scrolling, and restores trigger focus on close', async () => {
    setViewportWidth(390);

    render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <Shell current="overview" onNav={() => undefined}>
          <main>Page content</main>
        </Shell>
      </ContentContext.Provider>,
    );

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    trigger.focus();
    fireEvent.click(trigger);

    const drawer = screen.getByRole('dialog', { name: 'Main navigation' });
    expect(document.activeElement).toBe(drawer);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.querySelector('.shell')?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Main navigation' })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
    expect(document.body.style.overflow).toBe('');
    expect(document.querySelector('.shell')?.hasAttribute('aria-hidden')).toBe(false);
  });
});

describe('desktop rail vitals', () => {
  it('shows the active character\'s persisted Fate and Fortune values', () => {
    setViewportWidth(1024);
    localStorage.setItem('gc.c1.vitals', JSON.stringify({
      fate: 3,
      fortune: 1,
      resilience: 0,
      resolve: 0,
      corruption: 0,
    }));
    _resetStoredCache();

    const { container } = render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <Shell current="overview" onNav={() => undefined}>
          <main>Page content</main>
        </Shell>
      </ContentContext.Provider>,
    );

    expect(container.querySelector('.rail-vitals')?.textContent).toContain('Fate3·1');
  });
});
