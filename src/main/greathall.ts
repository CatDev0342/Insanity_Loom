// Reading a GreatHall's file, and the library it names.
//
// The file says what belongs together; this reads it, finds the documents it lists, and answers two questions about
// them: what stands at an address, and what a whole document says. The documents are the author's own files, edited
// in the panel and written back as they are — Markdown in, Markdown out, with nothing of ours added to them.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { GREATHALL_FORMAT, documentOf, type GreatHall, type HallDocument, type HallSection } from '../shared/greathall';
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
    alcove: beside(folder, asText(hall['alcove']), '.'),
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

  document(address: string): string {
    return readFileSync(this.fileOf(address).path, 'utf8');
  }

  saveDocument(address: string, markdown: string): void {
    writeFileSafely(this.fileOf(address).path, markdown);
  }
}
