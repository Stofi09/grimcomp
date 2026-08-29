import { describe, it, expect } from 'vitest';
import { resolveCast } from './magic';

describe('resolveCast — WFRP 4e casting vs CN + Overcasting', () => {
  it('casts when test SL alone meets the CN', () => {
    const r = resolveCast(5, 0, 5, true);
    expect(r.cast).toBe(true);
    expect(r.totalSl).toBe(5);
    expect(r.surplus).toBe(0);
    expect(r.overcasts).toBe(0);
  });

  it('banks the Channelling pool toward a high CN over rounds', () => {
    // CN 8 spell: test scores +3, but 6 SL were channelled over prior rounds.
    const r = resolveCast(3, 6, 8, true);
    expect(r.totalSl).toBe(9);
    expect(r.cast).toBe(true);
    expect(r.surplus).toBe(1); // 9 - 8
    expect(r.overcasts).toBe(0); // needs 2 surplus per overcast
  });

  it('fizzles when total SL is short of the CN', () => {
    const r = resolveCast(2, 1, 7, true);
    expect(r.cast).toBe(false);
    expect(r.surplus).toBe(0);
  });

  it('grants Overcasting: one effect per 2 surplus SL', () => {
    const r = resolveCast(4, 6, 4, true); // total 10 vs CN 4 → surplus 6
    expect(r.cast).toBe(true);
    expect(r.surplus).toBe(6);
    expect(r.overcasts).toBe(3);
  });

  it('a failed casting test never casts, even with a large pool', () => {
    const r = resolveCast(-1, 20, 5, false);
    expect(r.totalSl).toBe(19);
    expect(r.cast).toBe(false);
    expect(r.surplus).toBe(0);
  });

  it('treats a negative pool as zero', () => {
    const r = resolveCast(6, -3, 5, true);
    expect(r.pooledSl).toBe(0);
    expect(r.totalSl).toBe(6);
    expect(r.cast).toBe(true);
  });

  it('does not let a failed zero-SL test cast a CN 0 spell', () => {
    const r = resolveCast(0, 10, 0, false);
    expect(r.totalSl).toBe(10);
    expect(r.cast).toBe(false);
    expect(r.surplus).toBe(0);
    expect(r.overcasts).toBe(0);
  });
});
