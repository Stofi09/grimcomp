import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBundledPacks } from './loader';

const pack = (id: string) => ({ $schema: 'grimcomp.content.v2', id, name: id, version: '1' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadBundledPacks', () => {
  it('requests every pack before any finishes, and keeps manifest order', async () => {
    const files = ['first.json', 'second.json', 'third.json'];
    const pending = new Map<string, () => void>();
    const started: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const file = url.split('/').pop()!;
      if (file === 'manifest.json') {
        return new Response(JSON.stringify({ $schema: 'grimcomp.manifest.v1', packs: files }));
      }
      started.push(file);
      // Hold each pack until released so the test observes concurrency.
      await new Promise<void>(release => pending.set(file, release));
      return new Response(JSON.stringify(pack(file.replace('.json', ''))));
    }));

    const loading = loadBundledPacks();
    await vi.waitFor(() => expect(started).toEqual(files));
    // Finish out of order; the result must still follow the manifest.
    for (const file of [...files].reverse()) pending.get(file)!();
    const { packs, errors } = await loading;

    expect(errors).toEqual([]);
    expect(packs.map(p => p.id)).toEqual(['first', 'second', 'third']);
  });

  it('reports a failed pack without dropping the others', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const file = url.split('/').pop()!;
      if (file === 'manifest.json') {
        return new Response(JSON.stringify({ $schema: 'grimcomp.manifest.v1', packs: ['ok.json', 'missing.json'] }));
      }
      if (file === 'missing.json') return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(pack('ok')));
    }));

    const { packs, errors } = await loadBundledPacks();
    expect(packs.map(p => p.id)).toEqual(['ok']);
    expect(errors).toEqual(['missing.json: HTTP 404']);
  });
});
