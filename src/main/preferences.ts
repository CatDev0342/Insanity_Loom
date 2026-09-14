// The author's preferences — how Insanity_Loom behaves for them, apart from where the assistant runs — kept in
// Data/preferences.json and changed in Edit ▸ Preferences. Until the author changes one, the defaults apply and there
// is no file; a file that cannot be read is reported by name, never silently replaced.
//
// The personal dictionary is not here: Chromium keeps it itself, in the session data inside the Data folder.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SPELLING, type SpellingPreferences } from '../shared/editing';
import { writeFileSafely } from './files';

export const PREFERENCES_FILE_NAME = 'preferences.json';

// Version 1 held the spelling preferences alone; version 2 added the assistant's way of working; version 3 adds the
// alcove the author keeps their whispers in. An older file is upgraded, and written back complete, when read.
const PREFERENCES_VERSION = 3;
const FIRST_VERSION = 1;
const SECOND_VERSION = 2;

export interface Preferences {
  readonly version: typeof PREFERENCES_VERSION;
  readonly spelling: SpellingPreferences;
  /** The way of working last chosen for the assistant, used again for later conversations; '' for its own default. */
  readonly assistantMode: string;
  /** The folder the author's whispers live in; '' for the Alcove folder beside the program. */
  readonly alcoveFolder: string;
  /** The GreatHall file last opened, so the next start opens it again; '' when none has been. */
  readonly greatHallPath: string;
  /** How wide the author made the panels either side of the whisper, in pixels; 0 for the width the page gives them. */
  readonly panelWidths: { readonly left: number; readonly right: number };
}

export const DEFAULT_PREFERENCES: Preferences = {
  version: PREFERENCES_VERSION,
  spelling: DEFAULT_SPELLING,
  greatHallPath: '',
  panelWidths: { left: 0, right: 0 },
  assistantMode: '',
  alcoveFolder: '',
};

// A mode's name as the protocol gives it: short, and without spaces or control characters.
const MODE_ID = /^[\w.:-]{1,64}$/;

export function readMode(value: unknown, where: string): string {
  if (value === '' || (typeof value === 'string' && MODE_ID.test(value))) return value;
  throw problem(where, '"assistantMode" must name a way of working, or be empty.');
}

// Preference files are written indented, so they can be read in any text editor.
const JSON_INDENT = 2;

// A language code as Chromium names spelling languages: "en", "en-US", "pt-BR"…
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function problem(where: string, what: string): Error {
  return new Error(`The preferences in ${where} cannot be used:\n\n${what}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads spelling preferences from an untrusted object — the file, or the panel — naming the first thing wrong. */
export function readSpelling(value: unknown, where: string): SpellingPreferences {
  if (!isObject(value)) throw problem(where, 'There are no spelling preferences.');
  const { enabled, languages } = value;
  if (typeof enabled !== 'boolean') throw problem(where, '"spelling.enabled" must be true or false.');
  if (!Array.isArray(languages) || !languages.every((code) => typeof code === 'string' && LANGUAGE_CODE.test(code))) {
    throw problem(where, '"spelling.languages" must be a list of language codes, such as "en-US".');
  }
  return { enabled, languages: languages as string[] };
}

export function loadPreferences(dataFolder: string): Preferences {
  const file = join(dataFolder, PREFERENCES_FILE_NAME);
  if (!existsSync(file)) return DEFAULT_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    throw problem(file, `It is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!isObject(parsed)) throw problem(file, 'It does not hold a preferences object.');
  if (parsed['version'] === FIRST_VERSION || parsed['version'] === SECOND_VERSION) {
    const upgraded: Preferences = {
      version: PREFERENCES_VERSION,
      spelling: readSpelling(parsed['spelling'], file),
      assistantMode: parsed['version'] === SECOND_VERSION ? readMode(parsed['assistantMode'], file) : '',
      alcoveFolder: '',
      greatHallPath: '',
      panelWidths: { left: 0, right: 0 },
    };
    savePreferences(dataFolder, upgraded);
    return upgraded;
  }
  if (parsed['version'] !== PREFERENCES_VERSION) {
    throw problem(file, `It is version ${String(parsed['version'])}, which this Insanity_Loom does not know.`);
  }
  return {
    version: PREFERENCES_VERSION,
    spelling: readSpelling(parsed['spelling'], file),
    assistantMode: readMode(parsed['assistantMode'], file),
    alcoveFolder: readFolder(parsed['alcoveFolder'], file),
    greatHallPath: typeof parsed['greatHallPath'] === 'string' ? parsed['greatHallPath'] : '',
    panelWidths: readPanelWidths(parsed['panelWidths']),
  };
}

export function savePreferences(dataFolder: string, preferences: Preferences): void {
  writeFileSafely(join(dataFolder, PREFERENCES_FILE_NAME), `${JSON.stringify(preferences, null, JSON_INDENT)}\n`);
}

/** How the author divided the screen, as far as it can be believed: anything else is the page's own choice. */
export function readPanelWidths(value: unknown): { readonly left: number; readonly right: number } {
  const said = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const width = (one: unknown): number => (typeof one === 'number' && Number.isFinite(one) && one >= 0 ? Math.round(one) : 0);
  return { left: width(said['left']), right: width(said['right']) };
}

export function readFolder(value: unknown, where: string): string {
  if (typeof value !== 'string') throw problem(where, '"alcoveFolder" must be a folder, or empty.');
  return value;
}

/** The same preferences with something changed: one place to add to as more is remembered. */
export function preferencesWith(preferences: Preferences, changed: Partial<Omit<Preferences, 'version'>>): Preferences {
  return { ...preferences, ...changed, version: PREFERENCES_VERSION };
}
