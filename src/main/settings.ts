// Insanity_Loom's settings, kept in Data/settings.json and changed in the application's own panels (Assistant ▸
// Connection Settings). Every option is written out in the file, so it can also be read in any text editor. There is
// no file until the author first saves the panel; a file that cannot be read is reported by name, never silently
// replaced.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectionProblems, DEFAULT_CONNECTION, type AssistantPlace, type ConnectionSettings } from '../shared/connection';
import { writeFileSafely } from './files';

export const SETTINGS_FILE_NAME = 'settings.json';

// The settings file's layout. Version 1 (Milestone 1's first cut) held the assistant as one command list; version 2
// names every connection option separately. A version 1 file is upgraded, and written back complete, when read.
const SETTINGS_VERSION = 2;
const FIRST_VERSION = 1;

export interface Settings {
  readonly version: typeof SETTINGS_VERSION;
  readonly connection: ConnectionSettings;
}

// Settings files are written indented, so the author can read and change them in any text editor.
const JSON_INDENT = 2;

function problem(where: string, what: string): Error {
  return new Error(`The settings in ${where} cannot be used:\n\n${what}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads connection settings from an untrusted object — the file, or the panel — naming everything wrong. */
export function readConnection(value: unknown, where: string): ConnectionSettings {
  if (!isObject(value)) throw problem(where, 'There are no connection settings.');
  const field = <T>(name: keyof ConnectionSettings, check: (candidate: unknown) => candidate is T, expected: string): T => {
    const candidate = value[name];
    if (!check(candidate)) throw problem(where, `"${name}" must be ${expected}.`);
    return candidate;
  };
  const isString = (candidate: unknown): candidate is string => typeof candidate === 'string';
  const isPlace = (candidate: unknown): candidate is AssistantPlace => candidate === 'docker' || candidate === 'local';
  const isStrings = (candidate: unknown): candidate is string[] => Array.isArray(candidate) && candidate.every(isString);
  const isNumber = (candidate: unknown): candidate is number => typeof candidate === 'number';
  const isBoolean = (candidate: unknown): candidate is boolean => typeof candidate === 'boolean';

  const connection: ConnectionSettings = {
    place: field('place', isPlace, '"docker" or "local"'),
    dockerProgram: field('dockerProgram', isString, 'text'),
    container: field('container', isString, 'text'),
    containerUser: field('containerUser', isString, 'text'),
    workingFolder: field('workingFolder', isString, 'text'),
    hostProgram: field('hostProgram', isString, 'text'),
    hostArguments: field('hostArguments', isStrings, 'a list of text'),
    handshakeSeconds: field('handshakeSeconds', isNumber, 'a number'),
    connectOnStart: field('connectOnStart', isBoolean, 'true or false'),
  };
  const problems = connectionProblems(connection);
  if (problems.length > 0) throw problem(where, problems.join('\n'));
  return connection;
}

/** Upgrades a version 1 file: its assistant section held the place, container, folder, and one command list. */
function upgradeFromFirstVersion(value: Record<string, unknown>, file: string): Settings {
  const assistant = value['assistant'];
  if (!isObject(assistant)) throw problem(file, 'It has no "assistant" section.');
  const command = assistant['hostCommand'];
  if (!Array.isArray(command) || command.length === 0 || !command.every((word) => typeof word === 'string')) {
    throw problem(file, '"assistant.hostCommand" must be a list of words: the program, then its arguments.');
  }
  const [hostProgram, ...hostArguments] = command as string[];
  return {
    version: SETTINGS_VERSION,
    connection: readConnection(
      {
        ...DEFAULT_CONNECTION,
        place: assistant['kind'],
        container: assistant['container'] ?? DEFAULT_CONNECTION.container,
        workingFolder: assistant['workingFolder'],
        hostProgram,
        hostArguments,
      },
      file,
    ),
  };
}

export function saveSettings(dataFolder: string, settings: Settings): void {
  writeFileSafely(join(dataFolder, SETTINGS_FILE_NAME), `${JSON.stringify(settings, null, JSON_INDENT)}\n`);
}

export function settingsWith(connection: ConnectionSettings): Settings {
  return { version: SETTINGS_VERSION, connection };
}

/** Reads the settings; undefined when the author has not saved any yet. An older file is upgraded in place. */
export function loadSettings(dataFolder: string): Settings | undefined {
  const file = join(dataFolder, SETTINGS_FILE_NAME);
  if (!existsSync(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    throw problem(file, `It is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!isObject(parsed)) throw problem(file, 'It does not hold a settings object.');

  const version = parsed['version'] ?? FIRST_VERSION;
  if (version === FIRST_VERSION) {
    const upgraded = upgradeFromFirstVersion(parsed, file);
    saveSettings(dataFolder, upgraded);
    return upgraded;
  }
  if (version !== SETTINGS_VERSION) throw problem(file, `It is version ${String(version)}, which this Insanity_Loom does not know.`);
  return settingsWith(readConnection(parsed['connection'], file));
}
