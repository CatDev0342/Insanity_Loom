// What every end-to-end test starts from: the repository's development Data folder, prepared, and the application
// started against it. A development run keeps its Data folder in the repository (src/main/portable.ts).
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPOSITORY = join(__dirname, '..', '..');
export const DATA = join(REPOSITORY, 'Data');
export const FAKE_ASSISTANT = join(REPOSITORY, 'tests', 'fixtures', 'fake-assistant.mjs');

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
export function prepareData(start: 'first start' | 'fake assistant'): void {
  mkdirSync(DATA, { recursive: true });
  rmSync(join(DATA, 'settings.json'), { force: true });
  rmSync(join(DATA, 'Journal'), { recursive: true, force: true });
  if (start === 'fake assistant') {
    writeFileSync(join(DATA, 'settings.json'), JSON.stringify({ version: 2, connection: FAKE_CONNECTION }));
  }
}

export async function launch(): Promise<{ application: ElectronApplication; page: Page }> {
  const application = await electron.launch({ args: [REPOSITORY] });
  const page = await application.firstWindow();
  return { application, page };
}
