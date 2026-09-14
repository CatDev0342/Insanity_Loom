// Searching a GreatHall: every whisper in the alcove and in the folders beneath it, read as it stands on the page.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asExpression, linesOfWhisper, searchHall } from '../../src/main/hall';
import type { GreatHall } from '../../src/shared/greathall';
import type { HallSearch } from '../../src/shared/hall';

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function alcove(): string {
  const folder = mkdtempSync(join(tmpdir(), 'insanity-loom-hall-'));
  made.push(folder);
  return folder;
}

function whisper(folder: string, name: string, body: string): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, `${name}.xhtml`),
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${name}</title>` +
      `<style>article.whisper p { color: red; }</style></head><body><article class="whisper">${body}</article></body></html>`,
  );
}

const PLAIN: HallSearch = {
  looked: '',
  everywhere: true,
  matchCase: false,
  wholeWord: false,
  regularExpression: false,
  includeThoughts: true,
  includeLibrary: false,
};

describe('reading a whisper for searching', () => {
  it('reads each block as a line of its own, without the markup', () => {
    expect(linesOfWhisper('<h2>A heading</h2><p>A <strong>bold</strong> line.</p><ul><li><p>an item</p></li></ul>')).toEqual([
      'A heading',
      'A bold line.',
      'an item',
    ]);
  });

  it('leaves out what is only in the head of the file', () => {
    const lines = linesOfWhisper('<head><title>A name</title><style>p { color: red; }</style></head><body><p>The writing.</p></body>');
    expect(lines).toEqual(['The writing.']);
  });
});

describe('how the writing is matched', () => {
  it('takes what was written as writing, not as a pattern, unless asked', () => {
    expect(asExpression({ ...PLAIN, looked: 'a.b' }).test('axb')).toBe(false);
    expect(asExpression({ ...PLAIN, looked: 'a.b' }).test('a.b')).toBe(true);
    expect(asExpression({ ...PLAIN, looked: 'a.b', regularExpression: true }).test('axb')).toBe(true);
  });

  it('pays no heed to capitals unless asked, and can be held to whole words', () => {
    expect(asExpression({ ...PLAIN, looked: 'loom' }).test('LOOM')).toBe(true);
    expect(asExpression({ ...PLAIN, looked: 'loom', matchCase: true }).test('LOOM')).toBe(false);
    expect(asExpression({ ...PLAIN, looked: 'loom', wholeWord: true }).test('the loom stands')).toBe(true);
    expect(asExpression({ ...PLAIN, looked: 'loom', wholeWord: true }).test('looming')).toBe(false);
  });
});

describe('searching the hall', () => {
  it('finds every place in every whisper, with the line and where in it', () => {
    const folder = alcove();
    whisper(folder, '2026-09-14 1200 First', '<p>The loom stands here.</p><p>Nothing of note.</p><h2>A loom again</h2>');
    whisper(folder, '2026-09-14 1300 Second', '<p>No mention here.</p>');

    const found = searchHall(folder, { ...PLAIN, looked: 'loom' });
    expect(found.looked).toBe(2);
    expect(found.found).toBe(2);
    expect(found.hits).toHaveLength(1);
    const hit = found.hits[0];
    expect(hit?.title).toBe('2026-09-14 1200 First');
    expect(hit?.kind).toBe('whisper');
    expect(hit?.lines.map((line) => [line.line, line.text, line.at])).toEqual([
      [1, 'The loom stands here.', 4],
      [3, 'A loom again', 2],
    ]);
  });

  it('looks in the folders beneath the alcove, and says which folder a whisper is in', () => {
    const folder = alcove();
    whisper(join(folder, 'Older'), '2026-09-01 1000 Kept', '<p>The loom again.</p>');
    expect(searchHall(folder, { ...PLAIN, looked: 'loom', everywhere: false }).hits).toHaveLength(0);
    const found = searchHall(folder, { ...PLAIN, looked: 'loom', everywhere: true });
    expect(found.hits[0]?.folder).toBe('Older');
  });

  it("looks in the assistant's thinking when asked, and names the whisper it belongs to", () => {
    const folder = alcove();
    whisper(folder, '2026-09-14 1200 First', '<p>Nothing here.</p>');
    writeFileSync(join(folder, '2026-09-14 1200 First.thoughts.md'), '## Turn 1 · now\n\nThinking about the loom.\n');

    expect(searchHall(folder, { ...PLAIN, looked: 'loom', includeThoughts: false }).hits).toHaveLength(0);
    const found = searchHall(folder, { ...PLAIN, looked: 'loom', includeThoughts: true });
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]?.kind).toBe('thinking');
    // The thinking is found, and what opens is the whisper it belongs to.
    expect(found.hits[0]?.path.endsWith('2026-09-14 1200 First.xhtml')).toBe(true);
    expect(found.hits[0]?.lines[0]?.line).toBe(3);
  });

  it('says plainly when a regular expression will not read, rather than finding nothing', () => {
    const folder = alcove();
    whisper(folder, '2026-09-14 1200 First', '<p>Anything.</p>');
    const found = searchHall(folder, { ...PLAIN, looked: '(unclosed', regularExpression: true });
    expect(found.problem).toContain('not a search');
    expect(found.hits).toHaveLength(0);
  });

  it('searches what is there when a folder of the hall is not', () => {
    const folder = alcove();
    whisper(folder, '2026-09-14 1200 First', '<p>The loom stands here.</p>');
    // A hall may name an alcove the author has not made yet, or one on a drive that is not plugged in.
    expect(searchHall(join(folder, 'not there at all'), { ...PLAIN, looked: 'loom' })).toEqual({
      hits: [],
      found: 0,
      looked: 0,
      problem: '',
    });
    expect(searchHall(folder, { ...PLAIN, looked: 'loom' }).found).toBe(1);
  });

  it('finds nothing for nothing, without reading a single file', () => {
    const folder = alcove();
    whisper(folder, '2026-09-14 1200 First', '<p>Anything.</p>');
    expect(searchHall(folder, { ...PLAIN, looked: '   ' })).toEqual({ hits: [], found: 0, looked: 0, problem: '' });
  });
});

describe("searching the hall's library as well", () => {
  /** A hall whose library holds one numbered document, as a project holds its own files. */
  function hallWith(folder: string): GreatHall {
    const library = join(folder, 'Library');
    mkdirSync(library, { recursive: true });
    writeFileSync(join(library, '40_DOCUMENT.md'), '# 40 Document\n\n## 40.6 — THE WIKI\n\nLinks between whispers.\n');
    return {
      name: 'A hall',
      path: join(folder, 'A hall.greathall'),
      alcove: folder,
      library,
      libraryName: 'Test Library',
      documents: [{ address: '40', file: '40_DOCUMENT.md', title: 'The document' }],
    };
  }

  it('looks in the library when asked, and says where in it the writing stands', () => {
    const folder = alcove();
    const hall = hallWith(folder);
    whisper(folder, '2026-09-14 1200 A whisper', '<p>Nothing about it here.</p>');

    expect(searchHall(folder, { ...PLAIN, looked: 'whispers', includeLibrary: false }, hall).hits).toHaveLength(0);
    const found = searchHall(folder, { ...PLAIN, looked: 'whispers', includeLibrary: true }, hall);
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]).toMatchObject({ kind: 'library', address: '40', title: 'The document', folder: 'Test Library' });
    expect(found.hits[0]?.lines[0]).toMatchObject({ line: 5, text: 'Links between whispers.' });
  });

  it('puts the library first, where a thing is defined, and the whispers after it', () => {
    const folder = alcove();
    const hall = hallWith(folder);
    whisper(folder, '2026-09-14 1200 A whisper', '<p>Links between whispers, as it happens.</p>');
    const found = searchHall(folder, { ...PLAIN, looked: 'Links between whispers', includeLibrary: true }, hall);
    expect(found.hits.map((hit) => hit.kind)).toEqual(['library', 'whisper']);
  });
});
