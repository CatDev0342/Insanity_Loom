import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Alcove, nameDate, nameFromTitle } from '../../src/main/alcove';

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function alcove(): Alcove {
  const folder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
  made.push(folder);
  return new Alcove(folder);
}

const WHEN = new Date(2026, 8, 14, 15, 32);

describe('naming a whisper', () => {
  it('begins with when it began, so an alcove reads in order', () => {
    expect(nameDate(WHEN)).toBe('2026-09-14 1532');
  });

  it('keeps what a file name may hold, and nothing else', () => {
    expect(nameFromTitle('Pole model: water/ice?')).toBe('Pole model water ice');
    expect(nameFromTitle('   spaced    out   ')).toBe('spaced out');
    expect(nameFromTitle('***')).toBe('Whisper');
    expect(nameFromTitle('ends with a dot.')).toBe('ends with a dot');
    expect(nameFromTitle('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe('the alcove', () => {
  it('makes a whisper named for its conversation, and reads it back', () => {
    const here = alcove();
    const path = here.create('First words', '<html/>', WHEN);
    expect(basename(path)).toBe('2026-09-14 1532 First words.xhtml');
    expect(here.read(path)).toBe('<html/>');
  });

  it('never writes over a whisper that is already there', () => {
    const here = alcove();
    const first = here.create('Same name', 'one', WHEN);
    const second = here.create('Same name', 'two', WHEN);
    expect(basename(second)).toBe('2026-09-14 1532 Same name (2).xhtml');
    expect(here.read(first)).toBe('one');
  });

  it('names a whisper after its conversation, keeping the date it began', () => {
    const here = alcove();
    const path = here.create('Untitled whisper', 'words', WHEN);
    const moved = here.rename(path, 'What the conversation became');
    expect(basename(moved)).toBe('2026-09-14 1532 What the conversation became.xhtml');
    expect(existsSync(path)).toBe(false);
    expect(here.read(moved)).toBe('words');
  });

  it('leaves a whisper where it is when the new name is taken', () => {
    const here = alcove();
    here.create('Taken', 'other', WHEN);
    const path = here.create('Untitled whisper', 'words', WHEN);
    expect(here.rename(path, 'Taken')).toBe(path);
  });

  it('writes crash-safely, leaving no temporary file behind', () => {
    const here = alcove();
    const path = here.create('Whisper', 'first', WHEN);
    here.write(path, 'second');
    expect(readFileSync(path, 'utf8')).toBe('second');
    expect(existsSync(`${path}.writing`)).toBe(false);
  });

  it('knows a whisper by its suffix', () => {
    expect(Alcove.isWhisper('/alcove/A whisper.xhtml')).toBe(true);
    expect(Alcove.isWhisper('/alcove/notes.txt')).toBe(false);
  });
});
