// Spelling without asking anyone for anything: the dictionaries the program ships, and where they are put.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shippedDictionaries, useShippedDictionaries } from '../../src/main/spelling';

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'insanity-loom-spelling-'));
  made.push(path);
  return path;
}

describe('the dictionaries the program ships', () => {
  it('are the compiled ones Chromium reads, and nothing else in the folder', () => {
    const shipped = folder();
    writeFileSync(join(shipped, 'en-US-10-1.bdic'), 'a dictionary');
    writeFileSync(join(shipped, 'README.txt'), 'not a dictionary');
    expect(shippedDictionaries(shipped)).toEqual(['en-US-10-1.bdic']);
  });

  it('say there are none when none were shipped', () => {
    expect(shippedDictionaries(join(folder(), 'not there'))).toEqual([]);
  });

  it('are put where Chromium looks, in every place it may look', () => {
    const shipped = folder();
    writeFileSync(join(shipped, 'en-US-10-1.bdic'), 'a dictionary');
    const data = folder();
    const session = folder();

    expect(useShippedDictionaries(shipped, [data, session])).toBe(2);
    expect(readdirSync(join(data, 'Dictionaries'))).toEqual(['en-US-10-1.bdic']);
    expect(readdirSync(join(session, 'Dictionaries'))).toEqual(['en-US-10-1.bdic']);
  });

  it("never write over one the author already has, which may be newer than ours", () => {
    const shipped = folder();
    writeFileSync(join(shipped, 'en-US-10-1.bdic'), 'ours');
    const data = folder();
    mkdirSync(join(data, 'Dictionaries'), { recursive: true });
    writeFileSync(join(data, 'Dictionaries', 'en-US-10-1.bdic'), 'theirs, fetched later');

    expect(useShippedDictionaries(shipped, [data])).toBe(0);
  });
});
