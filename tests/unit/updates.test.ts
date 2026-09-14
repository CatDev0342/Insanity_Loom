// Which build is newer than which.
import { describe, expect, it } from 'vitest';
import { isNewer } from '../../src/shared/updates';

describe('telling one build from another', () => {
  it('knows a later build when it sees one', () => {
    expect(isNewer('0.0.84', '0.0.83')).toBe(true);
    expect(isNewer('0.1.0', '0.0.99')).toBe(true);
    expect(isNewer('0.0.83', '0.0.83')).toBe(false);
    expect(isNewer('0.0.82', '0.0.83')).toBe(false);
  });

  it('counts, rather than comparing letters: 0.0.9 is not newer than 0.0.83', () => {
    expect(isNewer('0.0.9', '0.0.83')).toBe(false);
    expect(isNewer('0.0.83', '0.0.9')).toBe(true);
  });

  it('takes a version it cannot read as no newer than what is running', () => {
    expect(isNewer('what?', '0.0.83')).toBe(false);
  });
});
