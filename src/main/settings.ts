// Insanity_Loom's settings, kept in Data/settings.json. Created with defaults the first time; after that the file is
// the author's, and a file that cannot be read is reported by name, never silently replaced.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileSafely } from './files';

export const SETTINGS_FILE_NAME = 'settings.json';

/**
 * Where the assistant runs, and how Insanity_Loom reaches it.
 * - docker: in a Docker container on this computer; Insanity_Loom runs the host inside it with `docker exec`.
 * - local: on this computer directly; Insanity_Loom runs the host itself.
 * Either way the host speaks the Agent Client Protocol over its standard input and output.
 */
export type AssistantSettings =
  | {
      readonly kind: 'docker';
      readonly container: string;
      /** The folder, inside the container, the assistant works in. */
      readonly workingFolder: string;
      /** The command, inside the container, that starts the host: program first, then its arguments. */
      readonly hostCommand: readonly string[];
    }
  | {
      readonly kind: 'local';
      readonly workingFolder: string;
      readonly hostCommand: readonly string[];
    };

export interface Settings {
  readonly assistant: AssistantSettings;
}

// The first-run defaults describe the setup Insanity_Loom was first built against: Claude Code in a Docker container
// named my-assistant, with Node.js and the assistant host kept in the container's ~/work folder (see
// assistant-host/README.md). Anyone else changes them in Data/settings.json.
const DEFAULT_SETTINGS: Settings = {
  assistant: {
    kind: 'docker',
    container: 'my-assistant',
    workingFolder: '/home/me/project',
    hostCommand: [
      '/usr/local/bin/node',
      '/home/me/Insanity_Loom/assistant-host/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js',
    ],
  },
};

// Settings files are written indented, so the author can read and change them in any text editor.
const JSON_INDENT = 2;

function problem(file: string, what: string): Error {
  return new Error(`Insanity_Loom's settings file cannot be used:\n\n${file}\n\n${what}`);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Checks settings read from disk, naming the first thing wrong. */
export function validateSettings(value: unknown, file: string): Settings {
  if (typeof value !== 'object' || value === null) throw problem(file, 'It does not hold a settings object.');
  const assistant = (value as { assistant?: unknown }).assistant;
  if (typeof assistant !== 'object' || assistant === null) throw problem(file, 'It has no "assistant" section.');
  const { kind, container, workingFolder, hostCommand } = assistant as Record<string, unknown>;

  if (!nonEmptyString(workingFolder)) throw problem(file, '"assistant.workingFolder" must name a folder.');
  if (!Array.isArray(hostCommand) || hostCommand.length === 0 || !hostCommand.every(nonEmptyString)) {
    throw problem(file, '"assistant.hostCommand" must be a list of words: the program, then its arguments.');
  }
  const command = hostCommand as string[];

  if (kind === 'docker') {
    if (!nonEmptyString(container)) throw problem(file, '"assistant.container" must name the Docker container.');
    return { assistant: { kind, container, workingFolder, hostCommand: command } };
  }
  if (kind === 'local') return { assistant: { kind, workingFolder, hostCommand: command } };
  throw problem(file, '"assistant.kind" must be "docker" or "local".');
}

/** Reads the settings, creating the file with defaults the first time. */
export function loadSettings(dataFolder: string): Settings {
  const file = join(dataFolder, SETTINGS_FILE_NAME);
  if (!existsSync(file)) {
    writeFileSafely(file, `${JSON.stringify(DEFAULT_SETTINGS, null, JSON_INDENT)}\n`);
    return DEFAULT_SETTINGS;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    throw problem(file, `It is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return validateSettings(parsed, file);
}
