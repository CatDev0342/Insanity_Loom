// Searching a GreatHall: what passes between the page and the layer underneath when the author looks for something
// across everything they have written.
//
// A GreatHall is a collection of connected alcoves (10.3). Until the author says otherwise, it is read as the alcove
// and every folder beneath it — the way a project is a folder and everything under it — so nothing new has to be
// recorded anywhere for this to work.

/** What the author asked for. */
export interface HallSearch {
  readonly looked: string;
  /** The alcove alone, or the whole GreatHall: every folder beneath it as well. */
  readonly everywhere: boolean;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  /** Read what was written as a regular expression, as an advanced find window offers. */
  readonly regularExpression: boolean;
  /** Look in the companion documents too, where the assistant's thinking is kept (40.8). */
  readonly includeThoughts: boolean;
  /** Look in the GreatHall's library as well: a project is searched across everything in it (40.10). */
  readonly includeLibrary: boolean;
}

/** One line holding what was looked for, and where in it. */
export interface HallLine {
  /** Which line of the document it is, counting from one. */
  readonly line: number;
  readonly text: string;
  /** Where in the line the writing was found: characters from its start, and how many. */
  readonly at: number;
  readonly length: number;
}

/** One document holding what was looked for. */
export interface HallHit {
  /** The whisper's file, in full. For thinking, the whisper it belongs to. */
  readonly path: string;
  /** The whisper's name, as the author reads it. */
  readonly title: string;
  /** Where the writing was found: in a whisper, in the thinking beside it, or in the hall's library. */
  readonly kind: 'whisper' | 'thinking' | 'library';
  /** For a place in the library, the document's address, so it can be opened there. */
  readonly address: string;
  /** Which folder beneath the alcove it is in, or '' for the alcove itself. */
  readonly folder: string;
  readonly lines: readonly HallLine[];
  readonly found: number;
}

export interface HallFound {
  readonly hits: readonly HallHit[];
  /** How many places were found, in all. */
  readonly found: number;
  /** How many documents were looked in. */
  readonly looked: number;
  /** What went wrong, in words, when the search could not be made at all (a regular expression that will not read). */
  readonly problem: string;
}

export interface HallBridge {
  search(asked: HallSearch): Promise<HallFound>;
}

export const HALL_CHANNELS = {
  search: 'insanity-loom:hall-search',
} as const;
