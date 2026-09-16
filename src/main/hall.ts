// Searching a GreatHall: every whisper in the alcove, and in every folder beneath it, read and looked through — the
// way a project is searched across all its files.
//
// The writing is read as it stands on the page, not as the markup writes it (a whisper is XHTML, and `strong` is no
// part of what the author wrote). Each block of a whisper counts as a line, which is what makes a result worth
// showing: a paragraph, a heading, an item of a list. The companion documents where the assistant's thinking is kept
// are Markdown, and their lines are lines.

import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { GreatHall } from '../shared/greathall';
import type { HallFound, HallHit, HallLine, HallSearch } from '../shared/hall';

/** How many lines of one document are shown before the rest are counted but not listed. */
const MOST_LINES_SHOWN = 50;

/** How long a line may be before it is cut, in characters: a result is a glimpse, not the writing itself. */
const LONGEST_LINE_SHOWN = 200;

const WHISPER_SUFFIX = '.xhtml';
const THOUGHTS_SUFFIX = '.thoughts.md';

/** Everything that stands between one block of a whisper and the next. */
const BLOCK_ENDS = /<\/(?:p|h[1-6]|li|blockquote|pre|div|section|figcaption|td|th)>/gi;

/** The characters a file writes for themselves, as XML asks. */
const WRITTEN_FOR: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

function withoutMarkup(piece: string): string {
  return piece
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (written) => WRITTEN_FOR[written.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A whisper's writing, one line per block of it. */
export function linesOfWhisper(xhtml: string): readonly string[] {
  const body = xhtml.replace(/<head\b[\s\S]*?<\/head>/i, '');
  return body
    .split(BLOCK_ENDS)
    .map((piece) => withoutMarkup(piece))
    .filter((line) => line !== '');
}

/** What is looked for, as a regular expression: the same thing however the author asked for it. */
export function asExpression(asked: HallSearch): RegExp {
  const written = asked.regularExpression ? asked.looked : asked.looked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const whole = asked.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${written})(?![\\p{L}\\p{N}_])` : written;
  return new RegExp(whole, asked.matchCase ? 'gu' : 'giu');
}

/** Where the writing stands in these lines. */
function placesIn(lines: readonly string[], looking: RegExp): { readonly found: HallLine[]; readonly total: number } {
  const found: HallLine[] = [];
  let total = 0;
  lines.forEach((line, index) => {
    looking.lastIndex = 0;
    let match = looking.exec(line);
    let first = true;
    while (match !== null) {
      total += 1;
      if (first && found.length < MOST_LINES_SHOWN) {
        found.push({
          line: index + 1,
          text: line.length > LONGEST_LINE_SHOWN ? `${line.slice(0, LONGEST_LINE_SHOWN)}…` : line,
          at: match.index,
          length: match[0].length,
        });
        first = false;
      }
      // A search that can match nothing at all would never move on by itself.
      if (match[0] === '') looking.lastIndex += 1;
      match = looking.exec(line);
    }
  });
  return { found, total };
}

/**
 * Every file in a folder, and in the folders beneath it when the whole GreatHall is being looked through.
 *
 * A folder that is not there holds nothing: a GreatHall may name an alcove the author has not made yet, or one on a
 * drive that is not plugged in, and neither is a reason to refuse to search what *is* there.
 */
function filesIn(folder: string, beneath: boolean): readonly string[] {
  const found: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(folder, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (beneath) found.push(...filesIn(path, beneath));
      continue;
    }
    if (entry.isFile()) found.push(path);
  }
  return found;
}

/** The whisper a companion document belongs to. */
function whisperOfThoughts(path: string): string {
  return `${path.slice(0, -THOUGHTS_SUFFIX.length)}${WHISPER_SUFFIX}`;
}

/**
 * The library's own documents, looked through as well, when the author asks and a hall is open. They are looked
 * through in the order the hall lists them, which is the author's own order, and kept in it.
 *
 * A document that cannot be read is not passed over in silence: a hall pointing at a library that has moved would
 * otherwise answer every search with "nothing found", which is a different thing from "it is not there".
 */
function searchLibrary(
  hall: GreatHall,
  looking: RegExp,
): { readonly hits: HallHit[]; readonly looked: number; readonly found: number; readonly unread: string[] } {
  const hits: HallHit[] = [];
  const unread: string[] = [];
  let looked = 0;
  let found = 0;
  for (const document of hall.documents) {
    const path = join(hall.library, document.file);
    let contents: string;
    try {
      contents = readFileSync(path, 'utf8');
    } catch {
      unread.push(document.file);
      continue;
    }
    looked += 1;
    const places = placesIn(contents.split(/\r?\n/), looking);
    if (places.total === 0) continue;
    found += places.total;
    hits.push({
      path,
      title: document.title,
      kind: 'library',
      address: document.address,
      folder: hall.libraryName,
      lines: places.found,
      found: places.total,
    });
  }
  return { hits, looked, found, unread };
}

export function searchHall(alcoves: readonly string[], asked: HallSearch, hall?: GreatHall): HallFound {
  if (asked.looked.trim() === '') return { hits: [], found: 0, looked: 0, problem: '' };
  let looking: RegExp;
  try {
    looking = asExpression(asked);
  } catch (problem) {
    return { hits: [], found: 0, looked: 0, problem: `That is not a search Insanity_Loom can make: ${problem instanceof Error ? problem.message : String(problem)}` };
  }

  const hits: HallHit[] = [];
  let looked = 0;
  let found = 0;
  let unread: readonly string[] = [];
  if (asked.includeLibrary && hall !== undefined) {
    const library = searchLibrary(hall, looking);
    hits.push(...library.hits);
    looked += library.looked;
    found += library.found;
    unread = library.unread;
  }
  // Every alcove of the hall, one after another: a hall is a collection of connected alcoves. Each file is kept with
  // the alcove it came from, so a result can say which folder of which alcove it stands in.
  const files = alcoves.flatMap((alcove) => filesIn(alcove, asked.everywhere).map((path) => ({ alcove, path })));
  for (const { alcove, path } of files) {
    const isWhisper = path.toLowerCase().endsWith(WHISPER_SUFFIX);
    const isThoughts = asked.includeThoughts && path.toLowerCase().endsWith(THOUGHTS_SUFFIX);
    if (!isWhisper && !isThoughts) continue;
    // A file that cannot be read is passed over: one bad file must not stop the search.
    let contents: string;
    try {
      if (statSync(path).isDirectory()) continue;
      contents = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    looked += 1;
    const lines = isWhisper ? linesOfWhisper(contents) : contents.split(/\r?\n/);
    const places = placesIn(lines, looking);
    if (places.total === 0) continue;
    found += places.total;
    const whisper = isWhisper ? path : whisperOfThoughts(path);
    hits.push({
      path: whisper,
      title: basename(whisper).replace(/\.xhtml$/i, ''),
      kind: isWhisper ? 'whisper' : 'thinking',
      address: '',
      folder: relative(alcove, join(path, '..')).replace(/\\/g, '/'),
      lines: places.found,
      found: places.total,
    });
  }
  // The library first, where a thing is defined; then the whispers, newest first, as the alcove itself reads, with a
  // whisper before the thinking beside it.
  hits.sort((left, right) => {
    if (left.kind === 'library' && right.kind !== 'library') return -1;
    if (right.kind === 'library' && left.kind !== 'library') return 1;
    // Two documents of the library keep the order the hall lists them in: sorting is stable, and that order is the
    // author's own. Two whispers read newest first, as the alcove does, with a whisper before the thinking beside it.
    if (left.kind === 'library' && right.kind === 'library') return 0;
    return right.title.localeCompare(left.title) || left.kind.localeCompare(right.kind);
  });
  return {
    hits,
    found,
    looked,
    problem:
      unread.length === 0
        ? ''
        : `Some of the library could not be read, and was not looked through: ${unread.join(', ')}.`,
  };
}
