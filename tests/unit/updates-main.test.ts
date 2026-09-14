// Fetching a newer Insanity_Loom: what may be done in parts, and what is put in place when.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { howToUpdate, putTheUpdateInPlace, updateWaiting } from '../../src/main/updates';

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'insanity-loom-update-'));
  made.push(path);
  return path;
}

const HERE = { programFolder: '', dataFolder: '', version: '0.0.83', electron: '44.3.0' };

describe('whether a copy can update itself', () => {
  it('says it is the newest when it is', () => {
    expect(howToUpdate({ version: '0.0.83', electron: '44.3.0' }, HERE, true)).toEqual({ kind: 'the newest', version: '0.0.83' });
    expect(howToUpdate({ version: '0.0.82', electron: '44.3.0' }, HERE, true).kind).toBe('the newest');
  });

  it('fetches its own part when only that has changed', () => {
    expect(howToUpdate({ version: '0.0.84', electron: '44.3.0' }, HERE, true)).toMatchObject({ kind: 'ready to fetch', version: '0.0.84' });
  });

  it('asks for the whole program when what it runs on has moved', () => {
    expect(howToUpdate({ version: '0.0.84', electron: '45.0.0' }, HERE, true)).toEqual({
      kind: 'whole program needed',
      version: '0.0.84',
    });
  });

  it('asks for the whole program when the build published no part for this system', () => {
    expect(howToUpdate({ version: '0.0.84', electron: '44.3.0' }, HERE, false).kind).toBe('whole program needed');
  });
});

describe('an update waiting to be put in place', () => {
  it('is put in place at the start, and cleared away afterwards', () => {
    const data = folder();
    const program = folder();
    writeFileSync(join(program, 'app.asar'), 'the old program');
    const waiting = join(data, 'Update');
    mkdirSync(waiting, { recursive: true });
    const packagePath = join(waiting, 'part.zip');
    writeFileSync(packagePath, 'a package');
    writeFileSync(join(waiting, 'update.json'), JSON.stringify({ version: '0.0.84', package: packagePath }));

    const put = putTheUpdateInPlace({ ...HERE, programFolder: program, dataFolder: data }, (_package, into) => {
      writeFileSync(join(into, 'app.asar'), 'the new program');
    });

    expect(put).toBe('0.0.84');
    expect(readFileSync(join(program, 'app.asar'), 'utf8')).toBe('the new program');
    expect(updateWaiting(data)).toBeUndefined();
  });

  it('leaves the program exactly as it was when anything goes wrong', () => {
    const data = folder();
    const program = folder();
    writeFileSync(join(program, 'app.asar'), 'the old program');
    const waiting = join(data, 'Update');
    mkdirSync(waiting, { recursive: true });
    const packagePath = join(waiting, 'part.zip');
    writeFileSync(packagePath, 'a package');
    writeFileSync(join(waiting, 'update.json'), JSON.stringify({ version: '0.0.84', package: packagePath }));

    const put = putTheUpdateInPlace({ ...HERE, programFolder: program, dataFolder: data }, () => {
      throw new Error('that package is not a package');
    });

    expect(put).toBe('');
    // A program that runs is worth more than a program that is new.
    expect(readFileSync(join(program, 'app.asar'), 'utf8')).toBe('the old program');
    expect(updateWaiting(data)).toBeUndefined();
  });

  it('says there is nothing waiting when there is not', () => {
    expect(updateWaiting(folder())).toBeUndefined();
  });
});
