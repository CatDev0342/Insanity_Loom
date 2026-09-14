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

// A whisper's file name begins with when it began, so an alcove reads in order in any file manager.
const NAME_DATE_LENGTH = 'YYYY-MM-DD HHMM'.length;

// How much of a conversation's title a file name keeps.
const LONGEST_TITLE_IN_NAME = 60;

// What a file name may not hold on Windows or Linux: the forbidden punctuation, and every control character — which
// is exactly what the rule below would otherwise forbid writing down.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_IN_NAME = new RegExp('[<>:"/\\|?*\u0000-\u001f]', 'g');

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
    return taken;
  }

  static isWhisper(path: string): boolean {
    return path.toLowerCase().endsWith(WHISPER_SUFFIX);
  }
}
