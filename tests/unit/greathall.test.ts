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
  writeFileSync(
    file,
    JSON.stringify({
      format: GREATHALL_FORMAT,
      name: 'CoreGame',
      alcove: 'Alcove',
      library: {
        name: 'Master Design Library',
        folder: 'Library',
        documents: [
          { address: '40', file: '40_DOCUMENT.md', title: 'The document' },
          { address: 'PKG_mapgen', file: 'PKG_mapgen.md' },
        ],
      },
    }),
  );
  return { folder, file };
}

describe('the GreatHall file', () => {
  it('says where the whispers and the library are, and what the library holds', () => {
    const { folder, file } = hall();
    const read = readGreatHall(file);
    expect(read.name).toBe('CoreGame');
    expect(read.alcove).toBe(join(folder, 'Alcove'));
    expect(read.library).toBe(join(folder, 'Library'));
    expect(read.documents.map((document) => document.address)).toEqual(['40', 'PKG_mapgen']);
    // A document that says nothing about its title is called after its file.
    expect(read.documents[1]?.title).toBe('PKG_mapgen');
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
    });
  });

  it('says a place is not there rather than finding the wrong one', () => {
    expect(placeOf('## 40.6 — THE WIKI', '40.60')).toEqual({ line: 0, text: '' });
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
