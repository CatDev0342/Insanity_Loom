// How long the assistant has been writing, as the reply's label says it (src/renderer/src/loom/how-long.ts).
import { describe, expect, it } from 'vitest';
import { howLong, SAY_NOTHING_UNDER_SECONDS } from '../../src/renderer/src/loom/how-long';

describe('saying how long', () => {
  it('says nothing about the first few seconds — every reply takes those', () => {
    expect(howLong(0)).toBe('');
    expect(howLong(SAY_NOTHING_UNDER_SECONDS - 1)).toBe('');
  });

  it('speaks up once a wait is long enough to wonder about', () => {
    expect(howLong(20)).toBe(' · 20s');
    expect(howLong(59.6)).toBe(' · 59s');
  });

  it('says minutes once there are minutes, and drops a whole minute\'s seconds', () => {
    expect(howLong(60)).toBe(' · 1m');
    expect(howLong(150)).toBe(' · 2m 30s');
    expect(howLong(1200)).toBe(' · 20m');
  });

  it('says nothing about a time that is not a time', () => {
    expect(howLong(Number.NaN)).toBe('');
    expect(howLong(Number.POSITIVE_INFINITY)).toBe('');
  });
});
