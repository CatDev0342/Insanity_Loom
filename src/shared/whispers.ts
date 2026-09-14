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
  /** Asks the author for a whisper to open. Undefined when they choose none. */
  choose(): Promise<OpenWhisper | undefined>;
  /** Names the whisper's file after the conversation's title, keeping the date it began; returns where it now is. */
  rename(path: string, title: string): Promise<OpenWhisper>;
  /** Opens the alcove in the system's file manager. */
  showAlcove(): Promise<void>;
}

export const WHISPER_CHANNELS = {
  alcoveFolder: 'insanity-loom:alcove-folder',
  chooseAlcove: 'insanity-loom:alcove-choose',
  current: 'insanity-loom:whisper-current',
  create: 'insanity-loom:whisper-create',
  save: 'insanity-loom:whisper-save',
  choose: 'insanity-loom:whisper-choose',
  rename: 'insanity-loom:whisper-rename',
  showAlcove: 'insanity-loom:alcove-show',
} as const;
