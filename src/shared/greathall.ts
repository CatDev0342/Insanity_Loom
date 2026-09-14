// A GreatHall: the file that says what belongs together, and how what is written in one document points into
// another. It is to Insanity_Loom what a solution file is to a development tool (95.37).
//
// The file is JSON, and says three things: where the whispers of this hall are kept, which documents make up its
// library, and what each of those documents is addressed by. Everything else is worked out from those.
//
// Addresses are how a library is cited. The Master_Design_Library numbers every document, section, subsection and
// item — `31.2.4.2` is file 31, section 2, subsection 4, item 2 — and addresses packages by name, `PKG_mapgen.3.2`.
// A reference is therefore a document's address followed by numbers, and Insanity_Loom finds them in a reply by
// knowing the addresses the hall's own file declares. No pattern has to be written by hand for the common case.

/** One document of a GreatHall's library. */
export interface HallDocument {
  /** What it is cited as: "31", "PKG_mapgen". */
  readonly address: string;
  /** Where it is, relative to the library folder. */
  readonly file: string;
  /** What it is called, for the author to read; the file's name when it says nothing. */
  readonly title: string;
}

/** A GreatHall, as its file says it is. */
export interface GreatHall {
  readonly name: string;
  /** Where this hall's file is, in full, so everything else can be found from it. */
  readonly path: string;
  /**
   * Where the whispers of this hall are kept, in full. A hall is a collection of connected alcoves (`10.3`), so its
   * file may name several; the first is where new whispers go, and all of them are searched.
   */
  readonly alcoves: readonly string[];
  /** Where the library's documents are, in full. */
  readonly library: string;
  readonly libraryName: string;
  readonly documents: readonly HallDocument[];
}

/** One place in the library, as the panel lists it. */
export interface HallSection {
  /** The address cited: "40.6.2". */
  readonly address: string;
  /** The document it belongs to: "40". */
  readonly document: string;
  /** The line it stands on, counting from one; 0 when the library holds no such place. */
  readonly line: number;
  /** What is written there, as the author reads it; '' when there is no such place. */
  readonly text: string;
  /** What the document is called. */
  readonly title: string;
}

export const GREATHALL_SUFFIX = '.greathall';

/** What the file must say to be one of ours. */
export const GREATHALL_FORMAT = 'insanity-loom/greathall';

/**
 * Every reference to this hall's library in a piece of writing, in the order they stand, without repetition.
 *
 * A reference is one of the hall's document addresses, followed by numbers parted by dots: `40`, `40.6`, `40.6.2`,
 * `PKG_mapgen.3.2`. What stands before or after must not be a letter or digit, so a version number in prose or a
 * word ending in the address is not mistaken for a citation.
 */
export function referencesIn(written: string, addresses: readonly string[]): readonly string[] {
  const found = new Map<string, number>();
  for (const address of addresses) {
    const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // What stands before must not be a letter, a digit or a dot, so "1.40.6" is a version and not a citation; what
    // stands after must not be a letter or a digit, so a full stop ending a sentence is no part of the reference.
    const looking = new RegExp(`(?<![\\p{L}\\p{N}_.])${escaped}(?:\\.\\d+)*(?![\\p{L}\\p{N}_])`, 'gu');
    for (const match of written.matchAll(looking)) {
      // Where it was first written, so the list reads in the order of the reply.
      if (!found.has(match[0])) found.set(match[0], match.index);
    }
  }
  return [...found.entries()].sort((left, right) => left[1] - right[1]).map(([address]) => address);
}

/** Which document an address belongs to: the part before the first dot. */
export function documentOf(address: string): string {
  return address.split('.')[0] ?? address;
}

/** A library document as it was read, with a mark of the state it was in when it was read. */
export interface HallDocumentRead {
  readonly markdown: string;
  /**
   * What the file was when it was read — when it was last written, and how long it was. If it is not that any more,
   * someone else has written to it since, and what the author has in the panel is no longer the whole story.
   */
  readonly stamp: string;
}

export interface GreatHallBridge {
  /** The hall in use, or undefined when none has been opened. */
  current(): Promise<GreatHall | undefined>;
  /** Asks the author for a GreatHall file, and opens it. Undefined when they choose none. */
  choose(): Promise<GreatHall | undefined>;
  /** What stands at these addresses in the library. */
  sections(addresses: readonly string[]): Promise<readonly HallSection[]>;
  /** A library document, in full, for reading and editing in the panel. */
  document(address: string): Promise<HallDocumentRead>;
  /**
   * Writes a library document back, as the author edited it — but only if no one else has written to it since it was
   * read. The library is shared: the assistant writes to it with its own tools, and the author may have it open in
   * another program.
   */
  saveDocument(address: string, markdown: string, stamp: string): Promise<void>;
}

export const GREATHALL_CHANNELS = {
  current: 'insanity-loom:greathall-current',
  choose: 'insanity-loom:greathall-choose',
  sections: 'insanity-loom:greathall-sections',
  document: 'insanity-loom:greathall-document',
  saveDocument: 'insanity-loom:greathall-save-document',
} as const;
