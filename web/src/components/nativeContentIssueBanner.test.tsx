// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentStatus } from '../../../src/content/ContentProvider';
import { ContentIssueBanner } from '../../../src/components/ContentIssueBanner';

const host = vi.hoisted(() => ({ status: { catalogueIssues: [] } as ContentStatus }));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: { ios?: unknown; default?: unknown }) => options.ios ?? options.default },
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({ children, accessibilityRole }: { children?: React.ReactNode; accessibilityRole?: string }) => (
    <div role={accessibilityRole}>{children}</div>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../../../src/content/useContent', () => ({ useContentStatus: () => host.status }));

afterEach(cleanup);

describe('native bundled-catalogue error state', () => {
  it('renders nothing for a healthy catalogue', () => {
    host.status = { catalogueIssues: [] };
    const view = render(<ContentIssueBanner />);
    expect(view.container.textContent).toBe('');
  });

  it('names every bundled file that failed to load', () => {
    host.status = {
      catalogueIssues: [
        { source: 'winds-of-magic.json', message: 'Invalid native catalogue projection: spells[0].cn must be an integer.' },
        { source: 'core-faith.json', message: 'Pack id must be a string.' },
      ],
    };
    render(<ContentIssueBanner />);

    expect(screen.getByRole('alert').textContent).toContain('Some bundled rulebook data could not be loaded');
    expect(screen.getByText(/^winds-of-magic\.json: Invalid native catalogue projection/)).toBeTruthy();
    expect(screen.getByText('core-faith.json: Pack id must be a string.')).toBeTruthy();
  });
});
