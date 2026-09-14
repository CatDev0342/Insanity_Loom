// Starts the built application (npm run build first) and checks the foundation holds: a window opens, the page
// reaches the layer underneath only through the bridge, and everything is kept in the Data folder.
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, prepareData, REPOSITORY } from './helpers';

test('opens a window, through the bridge only, keeping its data beside itself', async () => {
  prepareData('fake assistant');
  const { application, page } = await launch();
  try {

    await expect(page).toHaveTitle(/Insanity_Loom/);
    await expect(page.locator('#menubar')).toBeVisible();
    await expect(page.locator('.whisper-editor')).toBeVisible();

    // The bridge answered: the engine's versions can only have come from the preload.
    const electronVersion = await page.evaluate(
      () => (globalThis as unknown as { insanityLoom: { versions: { electron: string } } }).insanityLoom.versions.electron,
    );
    expect(electronVersion).toMatch(/^\d+\.\d+\.\d+/);

    // The page itself cannot reach Node.js.
    const pageCanReachNode = await page.evaluate(() => typeof (globalThis as { require?: unknown }).require !== 'undefined');
    expect(pageCanReachNode).toBe(false);

    // A development run keeps its Data folder in the repository, as a built copy keeps it beside its executable.
    const userData = await application.evaluate(({ app }) => app.getPath('userData'));
    expect(userData).toBe(join(REPOSITORY, 'Data'));
    expect(existsSync(userData)).toBe(true);
  } finally {
    await application.close();
  }
});

test('nothing the program has put away is on the page when it starts', async () => {
  prepareData('fake assistant');
  const { application, page } = await launch();
  try {
    // The hidden attribute means hidden; a rule of ours setting `display` must not quietly win over it.
    await expect(page.locator('#find-bar')).toBeHidden();
    await expect(page.locator('#asks')).toBeHidden();
    await expect(page.locator('#mode-label')).toBeHidden();
  } finally {
    await application.close();
  }
});
