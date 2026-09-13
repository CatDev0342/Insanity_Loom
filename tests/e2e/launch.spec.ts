// Starts the built application (npm run build first) and checks the foundation holds: a window opens, the page
// reaches the layer underneath only through the bridge, and everything is kept in the Data folder.
import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Electron is pointed at the repository, whose package.json names the built entry point (out/main/index.js), so the
// application sees the repository as its own folder, as it does during development.
const REPOSITORY = join(__dirname, '..', '..');

test('opens a window, through the bridge only, keeping its data beside itself', async () => {
  const application = await electron.launch({ args: [REPOSITORY] });
  try {
    const page = await application.firstWindow();

    await expect(page).toHaveTitle(/Insanity_Loom/);
    await expect(page.locator('#menubar')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write here' })).toBeVisible();

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
