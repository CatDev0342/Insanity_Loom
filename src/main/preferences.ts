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

const PREFERENCES_VERSION = 1;

export interface Preferences {
  readonly version: typeof PREFERENCES_VERSION;
  readonly spelling: SpellingPreferences;
}

export const DEFAULT_PREFERENCES: Preferences = { version: PREFERENCES_VERSION, spelling: DEFAULT_SPELLING };

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
  if (parsed['version'] !== PREFERENCES_VERSION) {
    throw problem(file, `It is version ${String(parsed['version'])}, which this Insanity_Loom does not know.`);
  }
  return { version: PREFERENCES_VERSION, spelling: readSpelling(parsed['spelling'], file) };
}

export function savePreferences(dataFolder: string, preferences: Preferences): void {
  writeFileSafely(join(dataFolder, PREFERENCES_FILE_NAME), `${JSON.stringify(preferences, null, JSON_INDENT)}\n`);
}

export function preferencesWith(spelling: SpellingPreferences): Preferences {
  return { version: PREFERENCES_VERSION, spelling };
}
