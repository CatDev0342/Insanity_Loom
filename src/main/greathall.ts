// Reading a GreatHall's file, and the library it names.
//
// The file says what belongs together; this reads it, finds the documents it lists, and answers two questions about
// them: what stands at an address, and what a whole document says. The documents are the author's own files, edited
// in the panel and written back as they are — Markdown in, Markdown out, with nothing of ours added to them.
//
// The file is TOML, because a hall is written by hand: TOML carries comments, forgives a trailing comma, and says a
// list of documents as a run of plain blocks rather than as nested brackets. Halls written in JSON, the form the
// file first took, are still read exactly as before.
//
// Nothing here is silent. A hall that names no alcove, lists a document twice, or lists one with no address is
// refused by name; a library folder or a document that is not where the hall says it is does not stop the hall
// opening, but is carried on the hall as trouble and said in the panel. The one thing this must never do is write
// over a library another writer has changed, so writing is refused unless the file is exactly as it was read.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import {
  GREATHALL_FORMAT,
  documentOf,
  type GreatHall,
  type HallDocument,
  type HallDocumentRead,
  type HallForm,
  type HallSection,
} from '../shared/greathall';
import { writeFileSafely } from './files';

/** How many lines of a section are gathered for the list beside the whisper. */
const LINES_OF_A_SECTION = 3;

/** What a stamp says when the file it names is not there at all. */
const NOT_THERE = '';

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Where a path in the file points, given the folder the file is in. */
function beside(folder: string, written: string, fallback: string): string {
  const path = written === '' ? fallback : written;
  return isAbsolute(path) ? path : resolve(folder, path);
}

/**
 * What the file says, and in which form it was written.
 *
 * A hall that opens with `{` is JSON, whatever its name; anything else is read as TOML. Both are tried before the
 * file is given up on, so a hall is never called unreadable merely for being written in the other form.
 */
function whatItSays(path: string): { readonly said: unknown; readonly form: HallForm } {
  const written = readFileSync(path, 'utf8');
  const looksLikeJson = written.trimStart().startsWith('{');
  const first: HallForm = looksLikeJson ? 'JSON' : 'TOML';
  try {
    return { said: read(written, first), form: first };
  } catch (cause) {
    const other: HallForm = first === 'JSON' ? 'TOML' : 'JSON';
    try {
      return { said: read(written, other), form: other };
    } catch {
      throw new Error(
        `"${basename(path)}" is not a GreatHall Insanity_Loom can read: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }
}

function read(written: string, form: HallForm): unknown {
  return form === 'JSON' ? JSON.parse(written) : parseToml(written);
}

function asTable(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}

/**
 * Where this hall's whispers are kept. One alcove may be named with "alcove", several with "alcoves"; a hall is a
 * collection of connected alcoves, and its file says which. The first is where new whispers go.
 *
 * A hall that names none is refused: a hall whose whispers could be anywhere would quietly make its own folder an
 * alcove, and new whispers would be written beside the hall file without the author ever asking for that.
 */
function readAlcoves(path: string, folder: string, hall: Record<string, unknown>): readonly string[] {
  const many = Array.isArray(hall['alcoves'])
    ? hall['alcoves'].filter((one): one is string => typeof one === 'string' && one !== '')
    : [];
  const one = asText(hall['alcove']);
  const named = many.length > 0 ? many : one === '' ? [] : [one];
  if (named.length === 0) {
    throw new Error(`"${basename(path)}" does not say where its whispers are kept (it needs "alcove" or "alcoves").`);
  }
  return named.map((each) => beside(folder, each, '.'));
}

/** The documents the hall lists, refusing a list that says nothing, says a document twice, or leaves one unnamed. */
function readDocuments(path: string, library: Record<string, unknown>): readonly HallDocument[] {
  const listed = Array.isArray(library['documents']) ? library['documents'] : [];
  const documents: HallDocument[] = [];
  for (const [at, one] of listed.entries()) {
    const document = asTable(one);
    const address = asText(document['address']);
    const file = asText(document['file']);
    const which = `document ${String(at + 1)} of its library`;
    if (address === '') throw new Error(`"${basename(path)}" gives no address for ${which}.`);
    if (file === '') throw new Error(`"${basename(path)}" gives no file for ${which} (addressed "${address}").`);
    const already = documents.find((other) => other.address === address);
    if (already !== undefined) {
      throw new Error(
        `"${basename(path)}" addresses two documents "${address}" — "${already.file}" and "${file}". An address names one document.`,
      );
    }
    const title = asText(document['title']);
    documents.push({ address, file, title: title === '' ? file.replace(/\.md$/i, '') : title });
  }
  if (documents.length === 0) throw new Error(`"${basename(path)}" lists no documents in its library.`);
  return documents;
}

/** What the hall says is there and is not: worth telling the author, not worth refusing to open the hall for. */
function troubleWith(library: string, documents: readonly HallDocument[]): readonly string[] {
  if (!existsSync(library)) return [`The library folder "${library}" is not there.`];
  const missing = documents.filter((one) => !existsSync(join(library, one.file)));
  return missing.map((one) => `"${one.file}" (${one.address}) is not in the library folder.`);
}

/** Reads a GreatHall file. Throws, saying what is wrong, when it is not one. */
export function readGreatHall(path: string): GreatHall {
  const { said, form } = whatItSays(path);
  const hall = asTable(said);
  if (asText(hall['format']) !== GREATHALL_FORMAT) {
    throw new Error(`"${basename(path)}" does not say it is a GreatHall (its "format" must be "${GREATHALL_FORMAT}").`);
  }
  const folder = dirname(path);
  const library = asTable(hall['library']);
  const documents = readDocuments(path, library);
  const libraryFolder = beside(folder, asText(library['folder']), '.');
  const name = asText(hall['name']);
  return {
    name: name === '' ? basename(path).replace(/\.greathall$/i, '') : name,
    form,
    path,
    alcoves: readAlcoves(path, folder, hall),
    library: libraryFolder,
    libraryName: asText(library['name']) === '' ? 'Library' : asText(library['name']),
    documents,
    trouble: troubleWith(libraryFolder, documents),
  };
}

/**
 * Where an address stands in a document, and what is written there.
 *
 * A library numbers its own lines: a heading `## 40.6 — THE WIKI`, a subsection `### 40.6.2 — Links`, an item
 * `**40.6.2.1** — …`. What is looked for is a line whose first thing, once its markdown is set aside, is the address
 * itself. Anything structured that way can be read, whatever project it belongs to.
 *
 * A library should carry each address once. When it carries one twice — as a library does after a section is pasted
 * in a second time — the first is answered with, and the others are counted, so the panel can say so instead of
 * choosing one in silence.
 */
export function placeOf(
  markdown: string,
  address: string,
): { readonly line: number; readonly text: string; readonly alsoAt: readonly number[] } {
  const lines = markdown.split(/\r?\n/);
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Markdown's own marks before the address — heading hashes, bold stars, a list bullet — are stepped over.
  const looking = new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:[-*+]\\s*)?(?:\\*\\*|__)?\\s*${escaped}(?![\\p{L}\\p{N}_.])`, 'u');
  const standing: number[] = [];
  for (const [at, line] of lines.entries()) if (looking.test(line)) standing.push(at);
  const [first, ...others] = standing;
  if (first === undefined) return { line: 0, text: '', alsoAt: [] };
  const gathered = lines
    .slice(first, first + LINES_OF_A_SECTION)
    .map((line) => withoutMarkdownMarks(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { line: first + 1, text: gathered, alsoAt: others.map((at) => at + 1) };
}

/**
 * A line as the author reads it, without the marks markdown puts around it. Underscores are left alone where they
 * stand inside a word: a library addresses its packages `PKG_mapgen`, and that is not emphasis.
 */
function withoutMarkdownMarks(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\*\*|__/g, '')
    .replace(/[`*]/g, '');
}

/** What a file is at this moment: when it was last written, and how long it is. Empty when it is not there. */
export function stampOf(path: string): string {
  try {
    const about = statSync(path);
    return `${String(about.mtimeMs)}:${String(about.size)}`;
  } catch {
    return NOT_THERE;
  }
}

export class GreatHalls {
  private hall: GreatHall | undefined;

  /** Opens a GreatHall by its file, and keeps it as the one in use. */
  open(path: string): GreatHall {
    const hall = readGreatHall(path);
    this.hall = hall;
    return hall;
  }

  get current(): GreatHall | undefined {
    return this.hall;
  }

  /** Where a document of the hall's library is, in full. */
  private fileOf(address: string): { readonly path: string; readonly document: HallDocument } {
    const hall = this.hall;
    if (hall === undefined) throw new Error('No GreatHall is open. File ▸ Open GreatHall… opens one.');
    const document = hall.documents.find((one) => one.address === documentOf(address));
    if (document === undefined) throw new Error(`This GreatHall's library holds no document addressed "${documentOf(address)}".`);
    const path = join(hall.library, document.file);
    if (!existsSync(path)) throw new Error(`"${document.file}" is not where this GreatHall says it is.`);
    return { path, document };
  }

  /**
   * What stands at each of these addresses.
   *
   * An address the library does not hold is answered with nothing, which is the truth. A document that is not there,
   * or that could not be read, is answered with nothing AND with the reason: a hall pointing at a library that has
   * moved once looked exactly like a library with nothing in it.
   */
  sections(addresses: readonly string[]): readonly HallSection[] {
    return addresses.map((address) => {
      const document = documentOf(address);
      let found;
      try {
        found = this.fileOf(address);
      } catch (problem) {
        return { address, document, line: 0, text: '', title: document, alsoAt: [], trouble: why(problem) };
      }
      try {
        const place = placeOf(readFileSync(found.path, 'utf8'), address);
        return { address, document, line: place.line, text: place.text, title: found.document.title, alsoAt: place.alsoAt };
      } catch (problem) {
        return { address, document, line: 0, text: '', title: found.document.title, alsoAt: [], trouble: why(problem) };
      }
    });
  }

  document(address: string): HallDocumentRead {
    const path = this.fileOf(address).path;
    return { markdown: readFileSync(path, 'utf8'), stamp: stampOf(path) };
  }

  /**
   * Writes a document back, unless someone else has written to it since it was read.
   *
   * The library is not the author's alone: the assistant writes to it with its own tools, and the author may have it
   * open elsewhere. Writing over another writer's work without a word is the one thing a program holding someone's
   * library must never do, so this refuses and says so, and the panel offers to read it afresh.
   *
   * A write with no stamp is refused as well. A stamp is what the file was when it was read, and there is no such
   * thing as writing back a document that was never read: emptiness there once meant "write anyway", which let a
   * document that had been deleted and made again be written over without a word.
   */
  saveDocument(address: string, markdown: string, stamp: string): void {
    const found = this.fileOf(address);
    if (stamp === NOT_THERE) {
      throw new Error(`"${found.document.file}" was not read before it was written. Nothing was written over.`);
    }
    const now = stampOf(found.path);
    if (now !== stamp) {
      throw new Error(`"${found.document.file}" was changed outside Insanity_Loom since it was opened. Nothing was written over.`);
    }
    writeFileSafely(found.path, markdown);
  }
}

function why(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}
