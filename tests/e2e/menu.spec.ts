// The menu bar, used the way a desktop user's hands use one.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, prepareData } from './helpers';

let application: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  prepareData('fake assistant');
  ({ application, page } = await launch());
  await expect(page.locator('#status-text')).toHaveText(/Connected to Fake Assistant/);
});

test.afterEach(async () => {
  await application.close();
});

test('draws its own square-cornered menu bar, with no native menu', async () => {
  const nativeMenu = await application.evaluate(({ Menu }) => Menu.getApplicationMenu());
  expect(nativeMenu).toBeNull();

  await page.getByRole('menuitem', { name: 'File' }).click();
  const popup = page.getByRole('menu').first();
  await expect(popup).toBeVisible();
  await expect(popup).toHaveCSS('border-top-left-radius', '0px');
});

test('Alt+E opens Edit; arrows move; Esc steps back, then leaves', async () => {
  await page.keyboard.press('Alt+E');
  const edit = page.getByRole('menuitem', { name: 'Edit' });
  await expect(edit).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'View' })).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'View' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menuitem', { name: 'View' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('#menubar')).not.toHaveClass(/is-in-use/);
});

test('Alt tapped alone moves to the menu bar, and again leaves it', async () => {
  await page.keyboard.press('Alt');
  await expect(page.getByRole('menuitem', { name: 'File' })).toBeFocused();
  await page.keyboard.press('Alt');
  await expect(page.locator('#menubar')).not.toHaveClass(/is-in-use/);
});

test('View ▸ Zoom In by keyboard and by shortcut reach the layer underneath', async () => {
  const zoomLevel = (): Promise<number> =>
    application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel() ?? NaN);

  expect(await zoomLevel()).toBe(0);
  await page.keyboard.press('Alt+V');
  await page.keyboard.press('i');
  await expect.poll(zoomLevel).toBeGreaterThan(0);

  await page.keyboard.press('Control+0');
  await expect.poll(zoomLevel).toBe(0);
});
