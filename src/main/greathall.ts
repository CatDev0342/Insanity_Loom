// Reading a GreatHall's file, and the library it names.
//
// The file says what belongs together; this reads it, finds the documents it lists, and answers two questions about
// them: what stands at an address, and what a whole document says. The documents are the author's own files, edited
// in the panel and written back as they are — Markdown in, Markdown out, with nothing of ours added to them.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  GREATHALL_FORMAT,
  documentOf,
  type GreatHall,
  type HallDocument,
  type HallDocumentRead,
  type HallSection,
} from '../shared/greathall';
import { writeFileSafely } from './files';

/** How many lines of a section are gathered for the list beside the whisper. */
const LINES_OF_A_SECTION = 3;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Where a path in the file points, given the folder the file is in. */
function beside(folder: string, written: string, fallback: string): string {
  const path = written === '' ? fallback : written;
  return isAbsolute(path) ? path : resolve(folder, path);
}

/**
 * Where this hall's whispers are kept. One alcove may be named with "alcove", several with "alcoves"; a hall is a
 * collection of connected alcoves, and its file says which. The first is where new whispers go.
 */
function readAlcoves(folder: string, hall: Record<string, unknown>): readonly string[] {
  const many = Array.isArray(hall['alcoves']) ? hall['alcoves'].filter((one): one is string => typeof one === 'string') : [];
  const named = many.length > 0 ? many : [asText(hall['alcove'])];
  return named.map((one) => beside(folder, one, '.'));
}

/** Reads a GreatHall file. Throws, saying what is wrong, when it is not one. */
export function readGreatHall(path: string): GreatHall {
  let said: unknown;
  try {
    said = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`"${basename(path)}" is not a GreatHall Insanity_Loom can read: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
  const hall = (typeof said === 'object' && said !== null ? said : {}) as Record<string, unknown>;
  if (asText(hall['format']) !== GREATHALL_FORMAT) {
    throw new Error(`"${basename(path)}" does not say it is a GreatHall (its "format" must be "${GREATHALL_FORMAT}").`);
  }
  const folder = dirname(path);
  const library = (typeof hall['library'] === 'object' && hall['library'] !== null ? hall['library'] : {}) as Record<string, unknown>;
  const listed = Array.isArray(library['documents']) ? library['documents'] : [];
  const documents: HallDocument[] = [];
  for (const one of listed) {
    const document = (typeof one === 'object' && one !== null ? one : {}) as Record<string, unknown>;
    const address = asText(document['address']);
    const file = asText(document['file']);
    if (address === '' || file === '') continue;
    documents.push({ address, file, title: asText(document['title']) === '' ? file.replace(/\.md$/i, '') : asText(document['title']) });
  }
  if (documents.length === 0) throw new Error(`"${basename(path)}" lists no documents in its library.`);
  return {
    name: asText(hall['name']) === '' ? basename(path).replace(/\.greathall$/i, '') : asText(hall['name']),
    path,
    alcoves: readAlcoves(folder, hall),
    library: beside(folder, asText(library['folder']), '.'),
    libraryName: asText(library['name']) === '' ? 'Library' : asText(library['name']),
    documents,
  };
}

/**
 * Where an address stands in a document, and what is written there.
 *
 * A library numbers its own lines: a heading `## 40.6 — THE WIKI`, a subsection `### 40.6.2 — Links`, an item
 * `**40.6.2.1** — …`. What is looked for is a line whose first thing, once its markdown is set aside, is the address
 * itself. Anything structured that way can be read, whatever project it belongs to.
 */
export function placeOf(markdown: string, address: string): { readonly line: number; readonly text: string } {
  const lines = markdown.split(/\r?\n/);
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Markdown's own marks before the address — heading hashes, bold stars, a list bullet — are stepped over.
  const looking = new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:[-*+]\\s*)?(?:\\*\\*|__)?\\s*${escaped}(?![\\p{L}\\p{N}_.])`, 'u');
  const at = lines.findIndex((line) => looking.test(line));
  if (at === -1) return { line: 0, text: '' };
  const gathered = lines
    .slice(at, at + LINES_OF_A_SECTION)
    .map((line) => withoutMarkdownMarks(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { line: at + 1, text: gathered };
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

/** What a file is at this moment: when it was last written, and how long it is. */
export function stampOf(path: string): string {
  try {
    const about = statSync(path);
    return `${String(about.mtimeMs)}:${String(about.size)}`;
  } catch {
    return '';
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

  /** What stands at each of these addresses. Addresses the library does not hold are said to hold nothing. */
  sections(addresses: readonly string[]): readonly HallSection[] {
    return addresses.map((address) => {
      const document = documentOf(address);
      try {
        const found = this.fileOf(address);
        const place = placeOf(readFileSync(found.path, 'utf8'), address);
        return { address, document, line: place.line, text: place.text, title: found.document.title };
      } catch {
        return { address, document, line: 0, text: '', title: document };
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
   */
  saveDocument(address: string, markdown: string, stamp: string): void {
    const found = this.fileOf(address);
    const now = stampOf(found.path);
    if (stamp !== '' && now !== stamp) {
      throw new Error(`"${found.document.file}" was changed outside Insanity_Loom since it was opened. Nothing was written over.`);
    }
    writeFileSafely(found.path, markdown);
  }
}
