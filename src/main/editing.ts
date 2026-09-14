// Right-click menus and spelling, on the layer underneath's side. Chromium tells this layer about every right-click —
// what can be cut, copied or pasted there, and any misspelled word with its suggestions — and it is passed on to the
// page, which draws the menu. Spelling preferences and the personal dictionary are applied to the session here.

import { app, ipcMain, session } from 'electron';
import {
  EDITING_CHANNELS,
  LONGEST_DICTIONARY_WORD,
  type ContextDetails,
  type SpellingPreferences,
  type SpellingState,
} from '../shared/editing';
import { DEFAULT_PREFERENCES, loadPreferences, preferencesWith, readSpelling, savePreferences } from './preferences';

// A spelling suggestion can be a pair of words ("a lot" for "alot"), so it may be longer than one dictionary word.
const LONGEST_SUGGESTION = LONGEST_DICTIONARY_WORD * 2;

function word(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > LONGEST_DICTIONARY_WORD || /\s/.test(value.trim())) {
    throw new Error(`A dictionary entry must be a single word of at most ${LONGEST_DICTIONARY_WORD} characters.`);
  }
  return value.trim();
}

/**
 * Applies spelling preferences to the session. Languages are checked against those Chromium can use; an empty list
 * means the languages the system chose when Insanity_Loom started.
 */
function applySpelling(preferences: SpellingPreferences, systemLanguages: readonly string[]): void {
  const spelling = session.defaultSession;
  spelling.setSpellCheckerEnabled(preferences.enabled);
  // macOS uses its own spell checker, which chooses languages itself.
  if (process.platform === 'darwin') return;
  const available = new Set(spelling.availableSpellCheckerLanguages);
  const unknown = preferences.languages.filter((code) => !available.has(code));
  if (unknown.length > 0) throw new Error(`Insanity_Loom cannot check spelling in: ${unknown.join(', ')}.`);
  const chosen = preferences.languages.length > 0 ? preferences.languages : systemLanguages;
  if (chosen.length > 0) spelling.setSpellCheckerLanguages([...chosen]);
}

/** Relays right-clicks to the page and answers its spelling requests. Call once, when Electron is ready. */
export function startEditingServices(dataFolder: string): void {
  const systemLanguages = session.defaultSession.getSpellCheckerLanguages();
  // Preferences that cannot be read are reported in the Preferences panel, and the defaults serve meanwhile; the file
  // is left as it is until the author saves new ones.
  let problem = '';
  let preferences = DEFAULT_PREFERENCES;
  try {
    preferences = loadPreferences(dataFolder);
    applySpelling(preferences.spelling, systemLanguages);
  } catch (cause) {
    problem = cause instanceof Error ? cause.message : String(cause);
    preferences = DEFAULT_PREFERENCES;
    applySpelling(preferences.spelling, systemLanguages);
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.on('context-menu', (_menuEvent, params) => {
      const details: ContextDetails = {
        isEditable: params.isEditable,
        hasSelection: params.selectionText !== '',
        canUndo: params.editFlags.canUndo,
        canRedo: params.editFlags.canRedo,
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste,
        canSelectAll: params.editFlags.canSelectAll,
        misspelledWord: params.misspelledWord,
        suggestions: params.dictionarySuggestions,
      };
      contents.send(EDITING_CHANNELS.contextMenu, details);
    });
  });

  ipcMain.handle(EDITING_CHANNELS.replace, (event, suggestion: unknown) => {
    if (typeof suggestion !== 'string' || suggestion === '' || suggestion.length > LONGEST_SUGGESTION) {
      throw new Error('Insanity_Loom received an invalid spelling suggestion.');
    }
    event.sender.replaceMisspelling(suggestion);
  });

  ipcMain.handle(EDITING_CHANNELS.load, async (): Promise<SpellingState> => ({
    preferences: preferences.spelling,
    availableLanguages: [...session.defaultSession.availableSpellCheckerLanguages].sort(),
    dictionary: (await session.defaultSession.listWordsInSpellCheckerDictionary()).sort((a, b) => a.localeCompare(b)),
    problem,
  }));

  ipcMain.handle(EDITING_CHANNELS.save, (_event, candidate: unknown) => {
    const spelling = readSpelling(candidate, 'the Preferences panel');
    applySpelling(spelling, systemLanguages);
    preferences = preferencesWith(spelling);
    savePreferences(dataFolder, preferences);
    problem = '';
  });

  ipcMain.handle(EDITING_CHANNELS.addWord, (_event, candidate: unknown) => {
    if (!session.defaultSession.addWordToSpellCheckerDictionary(word(candidate))) {
      throw new Error('The word could not be added to the dictionary.');
    }
  });

  ipcMain.handle(EDITING_CHANNELS.removeWord, (_event, candidate: unknown) => {
    if (!session.defaultSession.removeWordFromSpellCheckerDictionary(word(candidate))) {
      throw new Error('The word could not be removed from the dictionary.');
    }
  });
}
