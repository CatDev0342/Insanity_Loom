// What passes between the page and the layer underneath about right-click menus and spelling. Chromium reports every
// right-click to the layer underneath with what only it knows — whether Cut, Copy and Paste can act right now, and,
// on a misspelled word, the spelling suggestions — and Insanity_Loom draws the menu itself, in the page, square like
// its menu bar (src/renderer/src/menu/context-menu.ts).

/** What Chromium knows about the place the author right-clicked. */
export interface ContextDetails {
  readonly isEditable: boolean;
  readonly hasSelection: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canCut: boolean;
  readonly canCopy: boolean;
  readonly canPaste: boolean;
  readonly canSelectAll: boolean;
  /** The misspelled word under the pointer, or '' when there is none. */
  readonly misspelledWord: string;
  readonly suggestions: readonly string[];
}

export interface SpellingPreferences {
  /** Whether misspelled words are underlined as the author types. */
  readonly enabled: boolean;
  /** The languages checked, as language codes ("en-US"); empty for the system's own choice. */
  readonly languages: readonly string[];
  /**
   * Whether Chromium may fetch a dictionary it does not have. Off by default: the program ships one, and fetching
   * the rest means asking Google for them, which is the author's choice to make and not ours (60.7.5).
   */
  readonly fetchDictionaries: boolean;
}

export const DEFAULT_SPELLING: SpellingPreferences = { enabled: true, languages: [], fetchDictionaries: false };

/** What the Preferences panel opens with. */
export interface SpellingState {
  readonly preferences: SpellingPreferences;
  /** Every language Insanity_Loom can check. */
  readonly availableLanguages: readonly string[];
  /** The author's own words, which are never marked as misspelled. */
  readonly dictionary: readonly string[];
  /** Why the saved preferences could not be read (the defaults are in use meanwhile), or '' when they could. */
  readonly problem: string;
}

export interface EditingBridge {
  /** Listens for right-clicks. Returns a function that stops listening. */
  onContextMenu(listener: (details: ContextDetails) => void): () => void;
  /** Replaces the misspelled word last right-clicked with a suggestion. */
  replaceMisspelling(suggestion: string): Promise<void>;
  loadSpelling(): Promise<SpellingState>;
  saveSpelling(preferences: SpellingPreferences): Promise<void>;
  addToDictionary(word: string): Promise<void>;
  removeFromDictionary(word: string): Promise<void>;
}

export const EDITING_CHANNELS = {
  contextMenu: 'insanity-loom:context-menu',
  replace: 'insanity-loom:spelling-replace',
  load: 'insanity-loom:spelling-load',
  save: 'insanity-loom:spelling-save',
  addWord: 'insanity-loom:dictionary-add',
  removeWord: 'insanity-loom:dictionary-remove',
} as const;

/** The longest word accepted into the personal dictionary, in characters. */
export const LONGEST_DICTIONARY_WORD = 99;
