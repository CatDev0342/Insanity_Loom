import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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

describe('links between whispers', () => {
  it('finds a whisper in the alcove by the name a link carries, and nothing outside it', () => {
    const held = alcove();
    const path = held.create('A named conversation', '<whisper />', WHEN);
    const name = basename(path);

    expect(held.find(name)).toBe(path);
    // A link carries the name as a browser writes it, with its spaces spelled out.
    expect(held.find(encodeURIComponent(name))).toBe(path);
    expect(held.list().map((whisper) => whisper.name)).toContain(name);

    // Nothing that reaches out of the alcove, and nothing that is not a whisper.
    expect(held.find('../secret.xhtml')).toBeUndefined();
    expect(held.find('/etc/passwd')).toBeUndefined();
    expect(held.find('notes.txt')).toBeUndefined();
    expect(held.find('no such whisper.xhtml')).toBeUndefined();
  });
});

describe('renaming a whisper', () => {
  it('points the links that named it at where it now is', () => {
    const held = alcove();
    const pointedAt = held.create('First conversation', '<p>the one linked to</p>', WHEN);
    const oldName = basename(pointedAt);
    const pointing = held.create(
      'Second conversation',
      `<p><a href="${encodeURIComponent(oldName)}">there</a> and <a href="${encodeURIComponent(oldName)}#a-heading">into it</a></p>`,
      WHEN,
    );

    const moved = held.rename(pointedAt, 'First conversation, named at last');
    const newName = basename(moved);
    expect(newName).not.toBe(oldName);
    expect(held.relink(oldName, newName)).toBe(1);

    const after = readFileSync(pointing, 'utf8');
    expect(after).toContain(`href="${encodeURIComponent(newName)}"`);
    // The heading a link pointed into is kept: only the whisper's name changed.
    expect(after).toContain(`href="${encodeURIComponent(newName)}#a-heading"`);
    expect(after).not.toContain(encodeURIComponent(oldName));
  });

  it('leaves links to other whispers, and addresses that are not whispers, alone', () => {
    const held = alcove();
    const pointing = held.create(
      'A conversation',
      '<p><a href="https://example.com/page">out there</a><a href="Another whisper.xhtml">elsewhere</a></p>',
      WHEN,
    );
    expect(held.relink('2026-09-14 1532 Gone.xhtml', '2026-09-14 1532 Renamed.xhtml')).toBe(0);
    const after = readFileSync(pointing, 'utf8');
    expect(after).toContain('https://example.com/page');
    expect(after).toContain('Another whisper.xhtml');
  });
});

describe('what points here', () => {
  it('names the whispers that link to one, and the sections they point into', () => {
    const held = alcove();
    const pointedAt = held.create('The one pointed at', '<p>here</p>', WHEN);
    const name = basename(pointedAt);
    held.create('Points at it twice', `<p><a href="${encodeURIComponent(name)}#first">a</a><a href="${encodeURIComponent(name)}#second">b</a></p>`, WHEN);
    held.create('Points at the whole of it', `<p><a href="${encodeURIComponent(name)}">c</a></p>`, WHEN);
    held.create('Points somewhere else', '<p><a href="https://example.com/">d</a></p>', WHEN);

    const pointing = held.pointingAt(name);
    expect(pointing).toHaveLength(2);
    const twice = pointing.find((whisper) => whisper.name.includes('twice'));
    expect([...(twice?.headings ?? [])].sort()).toEqual(['first', 'second']);
    const whole = pointing.find((whisper) => whisper.name.includes('whole'));
    // Nothing after the name means the whisper itself, rather than a section of it.
    expect(whole?.headings).toEqual(['']);
    // A whisper does not count as pointing at itself.
    expect(held.pointingAt(name).some((whisper) => whisper.name === name)).toBe(false);
  });
});

describe('finding writing in the alcove', () => {
  it('finds what the author would read, not the markup around it', () => {
    const held = alcove();
    held.create(
      'About the loom',
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>About the loom</title></head><body>' +
        '<article class="whisper"><p>The <strong>loom</strong> holds a whisper. A loom again.</p></article></body></html>',
      WHEN,
    );
    held.create('Somewhere else', '<p>nothing of the kind here</p>', WHEN);

    const found = held.search('loom holds');
    expect(found).toHaveLength(1);
    // The words are read as they stand on the page, across the markup between them.
    expect(found[0]?.glimpse).toContain('The loom holds a whisper');
    // What is only in the markup is not writing, and is not found.
    expect(held.search('strong')).toHaveLength(0);
    expect(held.search('xhtml')).toHaveLength(0);
  });

  it('counts every place the writing appears, and pays no heed to capitals', () => {
    const held = alcove();
    held.create('A conversation', '<p>Loom, loom, LOOM.</p>', WHEN);
    const found = held.search('loom');
    expect(found[0]?.found).toBe(3);
  });

  it('finds nothing for nothing', () => {
    const held = alcove();
    held.create('A conversation', '<p>words</p>', WHEN);
    expect(held.search('   ')).toEqual([]);
  });

  it('reads the characters a file writes for itself', () => {
    const held = alcove();
    held.create('A conversation', '<p>Salt &amp; Pepper &lt;here&gt;</p>', WHEN);
    expect(held.search('Salt & Pepper')).toHaveLength(1);
    expect(held.search('<here>')).toHaveLength(1);
  });
});

describe('a whisper is renamed where it stands', () => {
  it('does not move a whisper out of the folder the author keeps it in', () => {
    const folder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
    made.push(folder);
    const beneath = join(folder, 'Beneath');
    mkdirSync(beneath, { recursive: true });
    const path = join(beneath, '2026-09-14 1532 Where it lives.xhtml');
    writeFileSync(path, '<html/>');
    // Find in Files reaches whispers in the folders beneath the alcove, and a hall may name several alcoves.
    const moved = new Alcove(folder).rename(path, 'Renamed');
    expect(dirname(moved)).toBe(beneath);
    expect(basename(moved)).toBe('2026-09-14 1532 Renamed.xhtml');
    expect(existsSync(join(folder, '2026-09-14 1532 Renamed.xhtml'))).toBe(false);
  });

  it("leaves a name the author gave it to begin as it does", () => {
    const folder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
    made.push(folder);
    const path = join(folder, 'Notes to myself.xhtml');
    writeFileSync(path, '<html/>');
    // The first fifteen characters of a name that is not a date are not a date, and were being pushed in front of
    // the new title: "Notes to myself Renamed.xhtml".
    expect(basename(new Alcove(folder).rename(path, 'Renamed'))).toBe('Renamed.xhtml');
  });
});

describe('a link written by hand is still read', () => {
  it('is not thrown over by an escape that is no escape', () => {
    const it_ = alcove();
    const path = it_.create('Pointed at', '<html/>', WHEN);
    // "%zz" is not an escape sequence; reading it back used to throw, and What Points Here gave up on the whole alcove.
    writeFileSync(join(it_.path, 'Pointing.xhtml'), '<a href="%zz.xhtml">broken</a><a href="' + encodeURIComponent(basename(path)) + '#A heading">good</a>');
    const pointing = it_.pointingAt(basename(path));
    expect(pointing.map((one) => one.name)).toEqual(['Pointing.xhtml']);
    expect(pointing[0]?.headings).toEqual(['A heading']);
    expect(it_.find('%zz.xhtml')).toBeUndefined();
  });
});

describe('thinking is added to, not written again', () => {
  it('keeps everything already written, and adds to the end', () => {
    const it_ = alcove();
    const path = it_.create('A conversation', '<html/>', WHEN);
    it_.addThought(path, '## Turn 1\n\nThinking.\n');
    it_.addThought(path, 'More thinking.\n');
    expect(readFileSync(Alcove.thoughtsOf(path), 'utf8')).toBe('## Turn 1\n\nThinking.\nMore thinking.\n');
  });
});
