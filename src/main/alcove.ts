// The alcove: the folder the author's whispers live in, as ordinary .xhtml files they can open in a browser, copy,
// back up or keep under version control. One whisper is one conversation.
//
// The alcove sits beside the program by default, so an Insanity_Loom carried on a USB stick carries its whispers with
// it; the author may put it anywhere (Edit > Preferences). Whispers are written crash-safely, as everything is.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writeFileSafely } from './files';

/** The folder name used when the author has not chosen one: beside the program, next to Data. */
export const DEFAULT_ALCOVE_NAME = 'Alcove';

const WHISPER_SUFFIX = '.xhtml';

/**
 * What the companion document is called: the whisper's own name with this instead of `.xhtml`. The assistant's
 * thinking is kept there rather than in the whisper, because the whisper is the author's prose — what they edit,
 * search and share — and thinking is a record beside it. Markdown, because thinking wants indexing, not formatting,
 * and because a file of it can be handed to another assistant without carrying the weight of a whole XHTML page.
 */
const THOUGHTS_SUFFIX = '.thoughts.md';

// A whisper's file name begins with when it began, so an alcove reads in order in any file manager.
const NAME_DATE_LENGTH = 'YYYY-MM-DD HHMM'.length;

// How much of a conversation's title a file name keeps.
const LONGEST_TITLE_IN_NAME = 60;

// What a file name may not hold on Windows or Linux: the forbidden punctuation, and every control character — which
// is exactly what the rule below would otherwise forbid writing down.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_IN_NAME = new RegExp('[<>:"/\\|?*\u0000-\u001f]', 'g');

/** How much of a whisper is shown around what was found, in characters either side. */
const GLIMPSE_EITHER_SIDE = 40;

/** The characters a whisper's file writes for themselves, as XML asks. */
const WRITTEN_FOR: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

/**
 * The writing in a whisper's file, without the markup around it: what the author would read on the page. Enough to
 * find words by; the whisper itself is the thing that is opened.
 */
function writingOf(xhtml: string): string {
  const body = xhtml.replace(/<head\b[\s\S]*?<\/head>/i, '');
  return body
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (written) => WRITTEN_FOR[written.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countOf(writing: string, wanted: string): number {
  let count = 0;
  for (let at = writing.indexOf(wanted); at !== -1; at = writing.indexOf(wanted, at + wanted.length)) count += 1;
  return count;
}

/** What is shown of a whisper around the writing found in it, with an ellipsis where it was cut. */
function glimpseAt(writing: string, where: number, length: number): string {
  const from = Math.max(0, where - GLIMPSE_EITHER_SIDE);
  const to = Math.min(writing.length, where + length + GLIMPSE_EITHER_SIDE);
  return `${from > 0 ? '…' : ''}${writing.slice(from, to)}${to < writing.length ? '…' : ''}`;
}

/** A link's address as it stands in a whisper's file. */
const LINK_ADDRESS = /href="([^"]*)"/g;

/** The whisper a link names, as it is written on disk, or '' when the link names no whisper. */
function readLinkName(address: string): string {
  const written = address.replace(/&amp;/g, '&');
  const name = written.split('#')[0] ?? '';
  try {
    return decodeURIComponent(name);
  } catch {
    return '';
  }
}

/** Whatever follows the whisper's name in a link: the heading it points at, with its '#', or nothing. */
function addressAfterName(address: string): string {
  const hash = address.indexOf('#');
  return hash === -1 ? '' : address.slice(hash);
}

/** When a name is already taken, the next free one is tried up to this many times before giving up. */
const MOST_NAME_TRIES = 999;

/** The date and time a whisper began, as its file name starts: "2026-09-14 1532". */
export function nameDate(when: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  return `${day} ${pad(when.getHours())}${pad(when.getMinutes())}`;
}

/** A conversation's title as a file name may hold it: nothing forbidden, no runs of spaces, and not endless. */
export function nameFromTitle(title: string): string {
  const cleaned = title.replace(FORBIDDEN_IN_NAME, ' ').replace(/\s+/g, ' ').trim().slice(0, LONGEST_TITLE_IN_NAME);
  // Windows also refuses a name ending in a dot or a space.
  const trimmed = cleaned.replace(/[. ]+$/, '');
  return trimmed === '' ? 'Whisper' : trimmed;
}

export class Alcove {
  private folder: string;

  constructor(folder: string) {
    this.folder = folder;
    mkdirSync(this.folder, { recursive: true });
  }

  get path(): string {
    return this.folder;
  }

  useFolder(folder: string): void {
    mkdirSync(folder, { recursive: true });
    this.folder = folder;
  }

  /** A file name no whisper has yet, for a conversation beginning now. */
  private freeName(title: string, when: Date): string {
    const base = `${nameDate(when)} ${nameFromTitle(title)}`;
    for (let attempt = 1; attempt <= MOST_NAME_TRIES; attempt++) {
      const name = attempt === 1 ? `${base}${WHISPER_SUFFIX}` : `${base} (${attempt})${WHISPER_SUFFIX}`;
      if (!existsSync(join(this.folder, name))) return name;
    }
    throw new Error(`The alcove already holds ${MOST_NAME_TRIES} whispers called "${base}".`);
  }

  /** Makes a new whisper file and returns its path. */
  create(title: string, xhtml: string, when: Date = new Date()): string {
    const path = join(this.folder, this.freeName(title, when));
    writeFileSafely(path, xhtml);
    return path;
  }

  /** Every whisper in the alcove, newest first — which is also newest by name, since a name begins with its date. */
  list(): readonly { readonly name: string; readonly path: string }[] {
    return readdirSync(this.folder)
      .filter((name) => Alcove.isWhisper(name))
      .sort((left, right) => right.localeCompare(left))
      .map((name) => ({ name, path: join(this.folder, name) }));
  }

  /**
   * The whisper of this name in the alcove — how a link from one whisper to another is followed. The name must be a
   * plain file name in the alcove itself: a link may not reach out of it into the rest of the computer.
   */
  find(name: string): string | undefined {
    const decoded = decodeURIComponent(name);
    if (decoded !== basename(decoded) || !Alcove.isWhisper(decoded)) return undefined;
    const path = join(this.folder, decoded);
    return existsSync(path) ? path : undefined;
  }

  read(path: string): string {
    return readFileSync(path, 'utf8');
  }

  write(path: string, xhtml: string): void {
    writeFileSafely(path, xhtml);
  }

  /**
   * Moves a whisper alongside its new title, keeping the date it began, so an alcove says what its whispers are
   * about. A name already taken is left alone rather than fought over.
   */
  rename(path: string, title: string): string {
    const current = basename(path);
    const began = current.slice(0, NAME_DATE_LENGTH);
    const wanted = `${began} ${nameFromTitle(title)}${WHISPER_SUFFIX}`;
    if (current === wanted || !existsSync(path)) return path;
    const taken = join(this.folder, wanted);
    if (existsSync(taken)) return path;
    renameSync(path, taken);
    this.moveThoughts(path, taken);
    return taken;
  }

  /**
   * Points every link in the alcove that named `from` at `to` instead — what a rename means for the whispers that
   * pointed at the one renamed. A link carries a file name, so without this a whisper being named after its
   * conversation would break every link to it.
   *
   * A link is written as a browser writes addresses, and read back the same way, so `A whisper.xhtml` and
   * `A%20whisper.xhtml` are the same link and both are put right. Returns how many whispers were changed.
   */
  relink(from: string, to: string): number {
    if (from === to) return 0;
    let changed = 0;
    for (const { path } of this.list()) {
      const before = readFileSync(path, 'utf8');
      const after = before.replace(LINK_ADDRESS, (whole, address: string) => {
        const pointed = readLinkName(address);
        return pointed === from ? whole.replace(address, encodeURIComponent(to) + addressAfterName(address)) : whole;
      });
      if (after === before) continue;
      writeFileSafely(path, after);
      changed += 1;
    }
    return changed;
  }

  /**
   * The whispers that link to this one, and which of its sections they point into. Read from the alcove each time it
   * is asked for, so it is never out of date with the files themselves.
   */
  pointingAt(name: string): readonly { readonly name: string; readonly headings: readonly string[] }[] {
    const found: { name: string; headings: string[] }[] = [];
    for (const whisper of this.list()) {
      if (whisper.name === name) continue;
      const headings = new Set<string>();
      for (const [, address] of readFileSync(whisper.path, 'utf8').matchAll(LINK_ADDRESS)) {
        if (address === undefined || readLinkName(address) !== name) continue;
        headings.add(decodeURIComponent(addressAfterName(address).replace(/^#/, '')));
      }
      if (headings.size > 0) found.push({ name: whisper.name, headings: [...headings] });
    }
    return found;
  }

  /**
   * The whispers holding this writing, most recent first, with a glimpse of where it was found. The alcove itself is
   * read each time, so what is found is what is on disk, never an index that has drifted from it.
   */
  search(looked: string): readonly { readonly name: string; readonly found: number; readonly glimpse: string }[] {
    const wanted = looked.trim().toLowerCase();
    if (wanted === '') return [];
    const found: { name: string; found: number; glimpse: string }[] = [];
    for (const whisper of this.list()) {
      const words = writingOf(readFileSync(whisper.path, 'utf8'));
      const where = words.toLowerCase().indexOf(wanted);
      if (where === -1) continue;
      found.push({ name: whisper.name, found: countOf(words.toLowerCase(), wanted), glimpse: glimpseAt(words, where, wanted.length) });
    }
    return found;
  }

  /** Where a whisper's thinking is kept: the companion document beside it. */
  static thoughtsOf(whisperPath: string): string {
    return `${whisperPath.slice(0, -WHISPER_SUFFIX.length)}${THOUGHTS_SUFFIX}`;
  }

  /** Adds to a whisper's companion document, making it if it is not there yet. */
  addThought(whisperPath: string, written: string): void {
    const path = Alcove.thoughtsOf(whisperPath);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
    writeFileSafely(path, `${before}${written}`);
  }

  /** Moves a whisper's companion document along with it, so the two never come apart. */
  private moveThoughts(from: string, to: string): void {
    const was = Alcove.thoughtsOf(from);
    if (!existsSync(was)) return;
    renameSync(was, Alcove.thoughtsOf(to));
  }

  static isWhisper(path: string): boolean {
    return path.toLowerCase().endsWith(WHISPER_SUFFIX);
  }
}
