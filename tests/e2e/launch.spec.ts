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

test('the running program keeps Chromium to itself and grants the page nothing', async () => {
  prepareData('fake assistant');
  const { application, page } = await launch();
  try {
    // The switches that stop a browser talking to its maker are given before Chromium starts.
    const switches = await application.evaluate(({ app }) => ({
      backgroundNetworking: app.commandLine.hasSwitch('disable-background-networking'),
      sync: app.commandLine.hasSwitch('disable-sync'),
      metrics: app.commandLine.hasSwitch('metrics-recording-only'),
      breakpad: app.commandLine.hasSwitch('disable-breakpad'),
    }));
    expect(switches).toEqual({ backgroundNetworking: true, sync: true, metrics: true, breakpad: true });

    // No browser permission is ever granted, whatever asks.
    const asked = await page.evaluate(async () => {
      try {
        const answer = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        return answer.state;
      } catch {
        return 'refused';
      }
    });
    expect(asked).not.toBe('granted');

    // The page is sandboxed and cannot reach Node.js or Electron.
    const reach = await page.evaluate(() => ({
      node: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      electron: typeof (globalThis as { electron?: unknown }).electron,
    }));
    expect(reach).toEqual({ node: 'undefined', process: 'undefined', electron: 'undefined' });
  } finally {
    await application.close();
  }
});
