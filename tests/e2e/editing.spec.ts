// The right-click menu and Edit ▸ Preferences, used as a desktop user would.
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

test('right-clicking the whisper opens a square menu of editing commands', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.type('some words to select');
  await whisper.click({ button: 'right' });

  const menu = page.getByRole('menu', { name: 'Context menu' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('border-top-left-radius', '0px');
  await expect(menu.getByRole('menuitem', { name: /Paste/ })).toBeVisible();
  // Nothing is selected yet, so Copy cannot act.
  await expect(menu.getByRole('menuitem', { name: /Copy/ })).toHaveAttribute('aria-disabled', 'true');

  // The underlined letter chooses: A for Select All. Focus goes back to the whisper first.
  await page.keyboard.press('a');
  await expect(menu).toBeHidden();
  const selected = await page.evaluate(() => (globalThis as unknown as { getSelection(): { toString(): string } }).getSelection().toString());
  expect(selected).toBe('some words to select');
});

test('Esc closes the right-click menu, leaving the whisper as it was', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Context menu' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(whisper).toBeFocused();
});

test('the right-click menu appears over a dialog, too', async () => {
  await page.keyboard.press('Alt+A');
  await page.keyboard.press('o');
  const panel = page.getByRole('dialog', { name: 'Connection Settings' });
  await panel.getByLabel('Working folder:').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Context menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /Select All/ }).click();
  await expect(menu).toBeHidden();
  await expect(panel).toBeVisible();
});

test('Edit ▸ Preferences keeps the personal dictionary', async () => {
  await page.keyboard.press('Alt+E');
  await page.keyboard.press('e');
  const panel = page.getByRole('dialog', { name: 'Preferences' });
  await expect(panel.getByLabel('Check spelling as you type')).toBeChecked();

  await panel.getByLabel('Add a word:').fill('whisperloom');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('status')).toHaveText('"whisperloom" added to your dictionary.');
  await expect(panel.getByRole('option', { name: 'whisperloom' })).toBeAttached();

  await panel.getByLabel('Your words:').selectOption('whisperloom');
  await panel.getByRole('button', { name: 'Remove' }).click();
  await expect(panel.getByRole('status')).toHaveText('"whisperloom" removed from your dictionary.');
  await expect(panel.getByRole('option', { name: 'whisperloom' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('Ctrl+F finds writing in the whisper, F3 goes on, Esc puts it away', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.type('one loom, two loom, three looms');

  await page.keyboard.press('Control+f');
  const bar = page.getByRole('search', { name: 'Find in this whisper' });
  await expect(bar).toBeVisible();
  await page.keyboard.type('loom');
  await expect(page.locator('#find-said')).toHaveText('1 of 3');
  await expect(whisper.locator('.is-found-now')).toHaveCount(1);

  await page.keyboard.press('F3');
  await expect(page.locator('#find-said')).toHaveText('2 of 3');
  await page.keyboard.press('Shift+F3');
  await expect(page.locator('#find-said')).toHaveText('1 of 3');

  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await expect(whisper.locator('.is-found-now')).toHaveCount(0);
  // The author is back in the whisper, writing where they were.
  await expect(whisper).toBeFocused();
});
