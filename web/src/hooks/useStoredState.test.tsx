// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { browserStorageCore } from '@/storage/browserStorage';
import {
  cleanupStorageTest,
  prepareStorageTest,
} from '@/test/storageTestUtils';
import {
  useStoragePersistenceStatus,
  useStoredState,
} from './useStoredState';

function ValueProbe({ storageKey }: { storageKey: string }) {
  const [value] = useStoredState(storageKey, 0);
  return <output data-testid="value">{value}</output>;
}

function StatusProbe() {
  const status = useStoragePersistenceStatus();
  return (
    <output data-testid="status">
      {status.dirty ? 'dirty' : 'clean'}:{status.lastError?.code ?? 'none'}
    </output>
  );
}

beforeEach(async () => {
  await prepareStorageTest();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await cleanupStorageTest();
});

describe('web external-store bindings', () => {
  it('rechecks a stored value changed between render and subscription', () => {
    localStorage.setItem('gc.subscribe-race', '1');
    const subscribe = browserStorageCore.subscribe.bind(browserStorageCore);
    let injected = false;
    vi.spyOn(browserStorageCore, 'subscribe').mockImplementation((key, listener) => {
      if (!injected && key === 'gc.subscribe-race') {
        injected = true;
        localStorage.setItem(key, '2');
        browserStorageCore.applyExternal(key, '2');
      }
      return subscribe(key, listener);
    });

    render(<ValueProbe storageKey="gc.subscribe-race" />);

    expect(screen.getByTestId('value').textContent).toBe('2');
  });

  it('rechecks persistence status changed between render and subscription', () => {
    const subscribeStatus = browserStorageCore.subscribeStatus.bind(browserStorageCore);
    let injected = false;
    vi.spyOn(browserStorageCore, 'subscribeStatus').mockImplementation((listener) => {
      if (!injected) {
        injected = true;
        localStorage.setItem('gc.status-race', '{bad');
        browserStorageCore.applyExternal('gc.status-race', '{bad');
      }
      return subscribeStatus(listener);
    });

    render(<StatusProbe />);

    expect(screen.getByTestId('status').textContent).toBe('dirty:decode_failed');
  });
});
