// What every end-to-end test starts from: the repository's development Data folder, prepared, and the application
// started against it. A development run keeps its Data folder in the repository (src/main/portable.ts).
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPOSITORY = join(__dirname, '..', '..');
export const DATA = join(REPOSITORY, 'Data');
export const FAKE_ASSISTANT = join(REPOSITORY, 'tests', 'fixtures', 'fake-assistant.mjs');
/** A GreatHall with a small library, for the tests that need one (tests/fixtures/hall). */
export const TEST_GREATHALL = join(REPOSITORY, 'tests', 'fixtures', 'hall', 'Testing.greathall');
/** Where a development run keeps its whispers: the Alcove folder beside the program, which is the repository. */
export const ALCOVE = join(REPOSITORY, 'Alcove');
/** Where the stand-in assistant records being signed in, when a test makes it require signing in. */
export const FAKE_AUTH_FILE = join(DATA, 'fake-assistant-sign-in.txt');

/** Connection settings for the stand-in assistant (tests/fixtures/fake-assistant.mjs), run on this computer. */
export const FAKE_CONNECTION = {
  place: 'local',
  dockerProgram: 'docker',
  container: '',
  containerUser: '',
  workingFolder: REPOSITORY,
  hostProgram: process.execPath,
  hostArguments: [FAKE_ASSISTANT],
  handshakeSeconds: 30,
  connectOnStart: true,
} as const;

/**
 * Clears what earlier tests left in Data — settings and journal — and, unless this is to be a first start, saves
 * settings that reach the stand-in assistant.
 */
export function prepareData(
  start: 'first start' | 'fake assistant' | 'fake assistant, signed out',
  options: { readonly history?: number; readonly keepJournal?: boolean; readonly greatHall?: boolean } = {},
): void {
  mkdirSync(DATA, { recursive: true });
  rmSync(join(DATA, 'settings.json'), { force: true });
  if (options.keepJournal !== true) {
    rmSync(join(DATA, 'Journal'), { recursive: true, force: true });
    rmSync(ALCOVE, { recursive: true, force: true });
  }
  rmSync(FAKE_AUTH_FILE, { force: true });
  // Preferences are what the program remembers of the author — the way of working, the alcove, the GreatHall — so
  // they are cleared only for a fresh start, never for a restart that is meant to find things as they were left.
  if (options.keepJournal !== true) rmSync(join(DATA, 'preferences.json'), { force: true });
  if (options.greatHall === true) {
    writeFileSync(
      join(DATA, 'preferences.json'),
      JSON.stringify({
        version: 3,
        spelling: { enabled: true, languages: [] },
        assistantMode: '',
        alcoveFolder: '',
        greatHallPath: TEST_GREATHALL,
      }),
    );
  }
  if (start === 'fake assistant') {
    const history = options.history ?? 1;
    const connection = { ...FAKE_CONNECTION, hostArguments: [FAKE_ASSISTANT, '--history', String(history)] };
    writeFileSync(join(DATA, 'settings.json'), JSON.stringify({ version: 2, connection }));
  }
  if (start === 'fake assistant, signed out') {
    const connection = { ...FAKE_CONNECTION, hostArguments: [FAKE_ASSISTANT, '--auth-file', FAKE_AUTH_FILE] };
    writeFileSync(join(DATA, 'settings.json'), JSON.stringify({ version: 2, connection }));
  }
}

export async function launch(): Promise<{ application: ElectronApplication; page: Page }> {
  const application = await electron.launch({ args: [REPOSITORY] });
  const page = await application.firstWindow();
  return { application, page };
}
