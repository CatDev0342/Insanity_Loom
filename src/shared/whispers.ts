// Whispers as files: what passes between the page and the layer underneath about the alcove and the whisper open in
// it. The layer underneath owns the files (src/main/whispers.ts); the page holds the document and says when it changes.

/** A whisper as it was read from, or written to, its file. */
export interface OpenWhisper {
  /** Where the file is, in full. */
  readonly path: string;
  /** Its file name, for the window title. */
  readonly name: string;
  readonly xhtml: string;
}

/** A whisper in the alcove, as the Link panel lists it. */
export interface WhisperInAlcove {
  readonly path: string;
  /** Its file name, which is also the address a link to it carries. */
  readonly name: string;
  /** Its name as the author reads it: the file name without the suffix. */
  readonly title: string;
}

/** A whisper that links to the one the author is in, and which of its sections it points into. */
export interface WhisperPointingHere {
  readonly name: string;
  readonly title: string;
  /** The identities of the headings pointed into; '' among them means the whisper as a whole. */
  readonly headings: readonly string[];
}

/** A whisper holding the writing looked for, and a glimpse of where it was found. */
export interface WhisperFound {
  readonly name: string;
  readonly title: string;
  /** How many times the writing appears in it. */
  readonly found: number;
  /** A little of the whisper around the first place it appears. */
  readonly glimpse: string;
}

/** A link from one whisper into another, or into a place in this one. */
export interface WhisperLink {
  /** The whisper's file name, or '' for a link within the whisper the author is in. */
  readonly name: string;
  /** The identity of the heading it points at, or '' for the whisper as a whole. */
  readonly heading: string;
}

/**
 * Reads an address as a link to a whisper, or says it is not one. A whisper link is a plain file name in the alcove —
 * nothing with a scheme of its own, nothing that reaches out of the alcove — and may end in `#` and the identity of a
 * heading within it. `#a-heading` alone points into the whisper the author is already in.
 */
export function readWhisperLink(address: string): WhisperLink | undefined {
  let written: string;
  try {
    written = decodeURIComponent(address);
  } catch {
    // An address that is not written the way a browser writes them is not a whisper's.
    return undefined;
  }
  const hash = written.indexOf('#');
  const name = hash === -1 ? written : written.slice(0, hash);
  const heading = hash === -1 ? '' : written.slice(hash + 1);
  if (name === '') return heading === '' ? undefined : { name, heading };
  return /^[^/\\:?#]+\.xhtml$/i.test(name) ? { name, heading } : undefined;
}

/** Whether an address is a link to a whisper at all. */
export function isWhisperAddress(address: string): boolean {
  return readWhisperLink(address) !== undefined;
}

export interface WhispersBridge {
  /** The folder the author's whispers live in. */
  alcoveFolder(): Promise<string>;
  /** Asks the author for another alcove folder. Returns the folder chosen, or '' when they choose none. */
  chooseAlcoveFolder(): Promise<string>;
  /** The whisper last open, when its file is still there. */
  current(): Promise<OpenWhisper | undefined>;
  /** Makes a new whisper in the alcove, and makes it the one open. */
  create(title: string, xhtml: string): Promise<OpenWhisper>;
  /** Saves the whisper open, at the path it was read from. */
  save(path: string, xhtml: string): Promise<void>;
  /** Adds to the companion document beside a whisper, where the assistant's thinking is kept. */
  addThought(path: string, written: string): Promise<void>;
  /** Keeps a copy of a whisper as it stands, before anything that might lose what is in it. Returns where it went. */
  keepCopy(path: string, why: string): Promise<string>;
  /** Every whisper in the alcove, newest first. */
  list(): Promise<readonly WhisperInAlcove[]>;
  /** Opens the whisper a link points at, by its file name in the alcove. */
  openNamed(name: string): Promise<OpenWhisper>;
  /** Opens a whisper by where its file is, which Find in Files gives in full. */
  openAt(path: string): Promise<OpenWhisper>;
  /** Reads a whisper in the alcove without opening it — to list what a link may point at inside it. */
  contents(name: string): Promise<string>;
  /** The whispers that link to this one. */
  pointingHere(name: string): Promise<readonly WhisperPointingHere[]>;
  /** The whispers in the alcove holding this writing. */
  search(looked: string): Promise<readonly WhisperFound[]>;
  /** Asks the author for a whisper to open. Undefined when they choose none. */
  choose(): Promise<OpenWhisper | undefined>;
  /** Names the whisper's file after the conversation's title, keeping the date it began; returns where it now is. */
  rename(path: string, title: string): Promise<OpenWhisper>;
  /**
   * Writes the whisper out as Markdown, asking the author where. Returns the file written, or '' when they chose
   * none.
   */
  exportMarkdown(suggestedName: string, markdown: string): Promise<string>;
  /** Opens the alcove in the system's file manager. */
  showAlcove(): Promise<void>;
}

export const WHISPER_CHANNELS = {
  alcoveFolder: 'insanity-loom:alcove-folder',
  chooseAlcove: 'insanity-loom:alcove-choose',
  current: 'insanity-loom:whisper-current',
  create: 'insanity-loom:whisper-create',
  save: 'insanity-loom:whisper-save',
  addThought: 'insanity-loom:whisper-add-thought',
  keepCopy: 'insanity-loom:whisper-keep-copy',
  choose: 'insanity-loom:whisper-choose',
  list: 'insanity-loom:whisper-list',
  openNamed: 'insanity-loom:whisper-open-named',
  openAt: 'insanity-loom:whisper-open-at',
  contents: 'insanity-loom:whisper-contents',
  pointingHere: 'insanity-loom:whisper-pointing-here',
  search: 'insanity-loom:whisper-search',
  rename: 'insanity-loom:whisper-rename',
  exportMarkdown: 'insanity-loom:whisper-export-markdown',
  showAlcove: 'insanity-loom:alcove-show',
} as const;
