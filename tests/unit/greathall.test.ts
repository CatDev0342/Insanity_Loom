// A GreatHall: the file that says what belongs together, the references an assistant's reply makes to its library,
// and where those references stand in it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GreatHalls, placeOf, readGreatHall } from '../../src/main/greathall';
import { documentOf, referencesIn, GREATHALL_FORMAT } from '../../src/shared/greathall';

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A hall written as one is written now: TOML, with the library's documents as a run of blocks. */
function tomlHall(): string {
  return [
    `format = "${GREATHALL_FORMAT}"`,
    'name = "CoreGame"',
    'alcove = "Alcove"',
    '',
    '[library]',
    'name = "Master Design Library"',
    'folder = "Library"',
    '',
    '# The library\'s own documents, each addressed as it is cited.',
    '[[library.documents]]',
    'address = "40"',
    'file = "40_DOCUMENT.md"',
    'title = "The document"',
    '',
    '[[library.documents]]',
    'address = "PKG_mapgen"',
    'file = "PKG_mapgen.md"',
    '',
  ].join('\n');
}

/** A hall like the designer's own: whispers beside it, a library of numbered documents in a folder of its own. */
function hall(): { readonly folder: string; readonly file: string } {
  const folder = mkdtempSync(join(tmpdir(), 'insanity-loom-hall-'));
  made.push(folder);
  const library = join(folder, 'Library');
  mkdirSync(library, { recursive: true });
  writeFileSync(
    join(library, '40_DOCUMENT.md'),
    ['# 40 Document', '', '## 40.6 — THE WIKI', '', 'Links between whispers.', '', '### 40.6.2 — Links between whispers', '', 'A link carries a file name.', ''].join('\n'),
  );
  writeFileSync(join(library, 'PKG_mapgen.md'), ['# PKG_mapgen', '', '**PKG_mapgen.3.2** — The bake formula.', ''].join('\n'));
  const file = join(folder, 'CoreGame.greathall');
  writeFileSync(file, tomlHall());
  return { folder, file };
}

describe('the GreatHall file', () => {
  it('says where the whispers and the library are, and what the library holds', () => {
    const { folder, file } = hall();
    const read = readGreatHall(file);
    expect(read.name).toBe('CoreGame');
    expect(read.alcoves).toEqual([join(folder, 'Alcove')]);
    expect(read.library).toBe(join(folder, 'Library'));
    expect(read.documents.map((document) => document.address)).toEqual(['40', 'PKG_mapgen']);
    // A document that says nothing about its title is called after its file.
    expect(read.documents[1]?.title).toBe('PKG_mapgen');
  });

  it('may name several alcoves, because a hall is a collection of connected ones', () => {
    const { folder, file } = hall();
    writeFileSync(
      file,
      JSON.stringify({
        format: GREATHALL_FORMAT,
        name: 'CoreGame',
        alcoves: ['Alcove', '../Another alcove'],
        library: { folder: 'Library', documents: [{ address: '40', file: '40_DOCUMENT.md' }] },
      }),
    );
    const read = readGreatHall(file);
    expect(read.alcoves).toEqual([join(folder, 'Alcove'), join(folder, '..', 'Another alcove')]);
  });

  it('refuses a file that is not one of ours, saying why', () => {
    const { folder } = hall();
    const wrong = join(folder, 'Other.greathall');
    writeFileSync(wrong, JSON.stringify({ name: 'Something else' }));
    expect(() => readGreatHall(wrong)).toThrow(/does not say it is a GreatHall/);
    writeFileSync(wrong, 'not json at all');
    expect(() => readGreatHall(wrong)).toThrow(/not a GreatHall Insanity_Loom can read/);
  });
});

describe('what a reply cites', () => {
  const addresses = ['40', 'PKG_mapgen'];

  it('finds the library addresses written in it, in the order they stand, once each', () => {
    const written = 'As 40.6.2 says, a link carries a file name — see also PKG_mapgen.3.2 and 40.6.2 again, and 40 itself.';
    expect(referencesIn(written, addresses)).toEqual(['40.6.2', 'PKG_mapgen.3.2', '40']);
  });

  it('is not fooled by numbers that are not citations', () => {
    expect(referencesIn('version 1.40.6 of it', addresses)).toEqual([]);
    expect(referencesIn('the 400 sections', addresses)).toEqual([]);
    expect(referencesIn('40.6.2.', addresses)).toEqual(['40.6.2']);
  });

  it('knows which document an address belongs to', () => {
    expect(documentOf('40.6.2')).toBe('40');
    expect(documentOf('PKG_mapgen.3.2')).toBe('PKG_mapgen');
  });
});

describe('where a reference stands in the library', () => {
  it('finds the line it is written on, and what is written there', () => {
    const markdown = ['# 40 Document', '', '## 40.6 — THE WIKI', '', 'Links between whispers.', ''].join('\n');
    const place = placeOf(markdown, '40.6');
    expect(place.line).toBe(3);
    expect(place.text).toContain('40.6 — THE WIKI');
  });

  it('reads an item written in bold, as a library numbers its items', () => {
    expect(placeOf('**PKG_mapgen.3.2** — The bake formula.', 'PKG_mapgen.3.2')).toEqual({
      line: 1,
      text: 'PKG_mapgen.3.2 — The bake formula.',
      alsoAt: [],
    });
  });

  it('says a place is not there rather than finding the wrong one', () => {
    expect(placeOf('## 40.6 — THE WIKI', '40.60')).toEqual({ line: 0, text: '', alsoAt: [] });
  });
});

describe('the library behind the list', () => {
  it('gives what stands at each address, and the whole document when it is opened', () => {
    const { file } = hall();
    const halls = new GreatHalls();
    halls.open(file);
    const sections = halls.sections(['40.6.2', 'PKG_mapgen.3.2', '40.9.9']);
    expect(sections[0]).toMatchObject({ address: '40.6.2', document: '40', line: 7, title: 'The document' });
    expect(sections[1]?.text).toContain('The bake formula.');
    // An address the library does not hold is said to hold nothing, rather than stopping everything.
    expect(sections[2]).toMatchObject({ address: '40.9.9', line: 0, text: '' });

    expect(halls.document('40.6.2').markdown).toContain('## 40.6 — THE WIKI');
  });

  it("writes the author's editing back to the library's own file", () => {
    const { file } = hall();
    const halls = new GreatHalls();
    halls.open(file);
    // Written with the state it was read in, as the panel does.
    halls.saveDocument('40.6.2', '# 40 Document\n\n## 40.6 — THE WIKI, rewritten\n', halls.document('40.6.2').stamp);
    expect(halls.document('40').markdown).toContain('THE WIKI, rewritten');
  });

  it('says plainly when nothing is open, or when the address belongs to no document', () => {
    const halls = new GreatHalls();
    expect(() => halls.document('40')).toThrow(/No GreatHall is open/);
    const { file } = hall();
    halls.open(file);
    expect(() => halls.document('99.1')).toThrow(/holds no document addressed "99"/);
  });
});

describe('the library is not the author\'s alone', () => {
  it('refuses to write over what someone else changed, and says so', () => {
    const { file } = hall();
    const halls = new GreatHalls();
    halls.open(file);
    const read = halls.document('40');

    // The assistant's own tools write to the library too; so may another program.
    writeFileSync(join(readGreatHall(file).library, '40_DOCUMENT.md'), '# 40 Document\n\nRewritten by someone else.\n');

    expect(() => halls.saveDocument('40', '# 40 Document\n\nThe author\'s own editing.\n', read.stamp)).toThrow(
      /changed outside Insanity_Loom/,
    );
    // Nothing was written over.
    expect(halls.document('40').markdown).toContain('Rewritten by someone else.');
  });

  it('writes when nothing else has, and marks what it wrote as the state it now knows', () => {
    const { file } = hall();
    const halls = new GreatHalls();
    halls.open(file);
    const read = halls.document('40');
    halls.saveDocument('40', '# 40 Document\n\nThe author wrote this.\n', read.stamp);
    const after = halls.document('40');
    expect(after.markdown).toContain('The author wrote this.');
    expect(after.stamp).not.toBe(read.stamp);
  });
});

describe('a hall is written by hand, so it is read strictly and said plainly', () => {
  /** Writes a hall file with these lines, in the folder of a hall already made. */
  function halSaying(folder: string, lines: readonly string[]): string {
    const file = join(folder, 'Written.greathall');
    writeFileSync(file, lines.join('\n'));
    return file;
  }

  it('is written in TOML, and says so', () => {
    const { file } = hall();
    expect(readGreatHall(file).form).toBe('TOML');
  });

  it('still reads a hall written in JSON, the form it first took', () => {
    const { folder } = hall();
    const file = join(folder, 'Older.greathall');
    writeFileSync(
      file,
      JSON.stringify({
        format: GREATHALL_FORMAT,
        name: 'CoreGame',
        alcove: 'Alcove',
        library: { folder: 'Library', documents: [{ address: '40', file: '40_DOCUMENT.md' }] },
      }),
    );
    const read = readGreatHall(file);
    expect(read.form).toBe('JSON');
    expect(read.documents.map((one) => one.address)).toEqual(['40']);
  });

  it('refuses a hall that does not say where its whispers are kept', () => {
    const { folder } = hall();
    const file = halSaying(folder, [
      `format = "${GREATHALL_FORMAT}"`,
      '[library]',
      'folder = "Library"',
      '[[library.documents]]',
      'address = "40"',
      'file = "40_DOCUMENT.md"',
    ]);
    // Before, this quietly made the hall's own folder the alcove, and new whispers were written beside the hall file.
    expect(() => readGreatHall(file)).toThrow(/does not say where its whispers are kept/);
  });

  it('refuses a hall that addresses two documents the same', () => {
    const { folder } = hall();
    const file = halSaying(folder, [
      `format = "${GREATHALL_FORMAT}"`,
      'alcove = "Alcove"',
      '[library]',
      'folder = "Library"',
      '[[library.documents]]',
      'address = "40"',
      'file = "40_DOCUMENT.md"',
      '[[library.documents]]',
      'address = "40"',
      'file = "PKG_mapgen.md"',
    ]);
    expect(() => readGreatHall(file)).toThrow(/addresses two documents "40"/);
  });

  it('refuses a document listed with no address or no file, saying which one', () => {
    const { folder } = hall();
    const noAddress = halSaying(folder, [
      `format = "${GREATHALL_FORMAT}"`,
      'alcove = "Alcove"',
      '[library]',
      'folder = "Library"',
      '[[library.documents]]',
      'file = "40_DOCUMENT.md"',
    ]);
    expect(() => readGreatHall(noAddress)).toThrow(/gives no address for document 1/);
    const noFile = halSaying(folder, [
      `format = "${GREATHALL_FORMAT}"`,
      'alcove = "Alcove"',
      '[library]',
      'folder = "Library"',
      '[[library.documents]]',
      'address = "40"',
      'file = "40_DOCUMENT.md"',
      '[[library.documents]]',
      'address = "PKG_mapgen"',
    ]);
    // Before, a document listed with nothing to find it by was passed over in silence.
    expect(() => readGreatHall(noFile)).toThrow(/gives no file for document 2 .*PKG_mapgen/);
  });

  it('opens a hall whose library has moved, and carries what is missing as trouble', () => {
    const { folder } = hall();
    const file = halSaying(folder, [
      `format = "${GREATHALL_FORMAT}"`,
      'alcove = "Alcove"',
      '[library]',
      'folder = "Library"',
      '[[library.documents]]',
      'address = "40"',
      'file = "40_DOCUMENT.md"',
      '[[library.documents]]',
      'address = "99"',
      'file = "99_GONE.md"',
    ]);
    const read = readGreatHall(file);
    expect(read.trouble).toEqual(['"99_GONE.md" (99) is not in the library folder.']);
    // A hall whose whole library folder is elsewhere says that once, rather than once per document.
    const elsewhere = halSaying(folder, [
      `format = "${GREATHALL_FORMAT}"`,
      'alcove = "Alcove"',
      '[library]',
      'folder = "Nowhere"',
      '[[library.documents]]',
      'address = "40"',
      'file = "40_DOCUMENT.md"',
    ]);
    expect(readGreatHall(elsewhere).trouble).toHaveLength(1);
    expect(readGreatHall(elsewhere).trouble[0]).toMatch(/library folder .* is not there/);
  });
});

describe('nothing found is told apart from nothing readable', () => {
  it('says why an address could not be read, and says nothing when the library simply holds no such place', () => {
    const { file } = hall();
    const halls = new GreatHalls();
    halls.open(file);
    const [missing, unheld, notListed] = halls.sections(['40.9.9', '40.6.2', '99.1']);
    // A place the library does not carry: nothing there, and nothing wrong.
    expect(missing).toMatchObject({ line: 0, text: '' });
    expect(missing?.trouble).toBeUndefined();
    expect(unheld?.line).toBeGreaterThan(0);
    // A document the hall does not list at all is a fault of the hall, and is said to be one.
    expect(notListed?.trouble).toMatch(/holds no document addressed "99"/);
  });

  it('says a document that has moved has moved, instead of looking like an empty library', () => {
    const { folder, file } = hall();
    const halls = new GreatHalls();
    halls.open(file);
    rmSync(join(folder, 'Library', '40_DOCUMENT.md'));
    const [section] = halls.sections(['40.6.2']);
    expect(section?.trouble).toMatch(/is not where this GreatHall says it is/);
  });

  it('answers with the first of an address written twice, and counts the others', () => {
    const twice = [
      '# 40 Document',
      '',
      '## 40.14 The whisper records what is said unasked',
      '',
      'Said once.',
      '',
      '## 40.14 The whisper records what is said unasked',
      '',
      'Said twice, by mistake.',
      '',
    ].join('\n');
    const place = placeOf(twice, '40.14');
    expect(place.line).toBe(3);
    expect(place.alsoAt).toEqual([7]);
  });
});

describe('a document that was never read is never written over', () => {
  it('refuses a write carrying no stamp', () => {
    const { file } = hall();
    const halls = new GreatHalls();
    halls.open(file);
    // Emptiness once meant "write anyway", which let a document deleted and made again be written over in silence.
    expect(() => halls.saveDocument('40', '# Written blind\n', '')).toThrow(/was not read before it was written/);
    expect(halls.document('40').markdown).toContain('THE WIKI');
  });
});
