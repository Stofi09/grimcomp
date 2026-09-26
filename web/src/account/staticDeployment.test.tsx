// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStoredState } from '@/hooks/useStoredState';
import { cleanupStorageTest, prepareStorageTest, waitForStorageIdle } from '@/test/storageTestUtils';
import { AccountPanel } from './AccountPanel';

vi.mock('@/hooks/useCharacter', () => ({ useCharacter: () => ({ id: 'c1', template: { name: 'Local character' } }) }));
vi.mock('@/content/useContent', () => {
  const content = { allCharacterTemplates: [{ id: 'c1' }], bundledPacks: [] };
  return { useContent: () => content };
});

function LocalGameplay() {
  const [wounds, setWounds] = useStoredState('gc.c1.wounds', 9);
  return <>
    <output aria-label="Local wounds">{wounds}</output>
    <button onClick={() => { setWounds(previous => previous - 1); }}>Change local wounds</button>
  </>;
}

beforeEach(prepareStorageTest);
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await cleanupStorageTest();
});

it('keeps local gameplay writable when the static deployment returns its API-disabled 503', async () => {
  const fetchMock = vi.fn(async () => new Response(
    JSON.stringify({ error: 'Account service is not enabled on this deployment.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);
  render(<><LocalGameplay /><AccountPanel /></>);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Account service is not enabled'));
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ method: 'GET' }));
  expect(screen.getByLabelText('Local wounds').textContent).toBe('9');
  fireEvent.click(screen.getByRole('button', { name: 'Change local wounds' }));
  await waitFor(() => expect(screen.getByLabelText('Local wounds').textContent).toBe('8'));
  await waitForStorageIdle();
  expect(localStorage.getItem('gc.c1.wounds')).toBe('8');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
