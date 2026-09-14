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

test('right-clicking the writing area opens a square menu of editing commands', async () => {
  const compose = page.locator('#compose');
  await compose.click();
  await page.keyboard.type('some words to select');
  await compose.click({ button: 'right' });

  const menu = page.getByRole('menu', { name: 'Context menu' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('border-top-left-radius', '0px');
  await expect(menu.getByRole('menuitem', { name: /Paste/ })).toBeVisible();
  // Nothing is selected yet, so Copy cannot act.
  await expect(menu.getByRole('menuitem', { name: /Copy/ })).toHaveAttribute('aria-disabled', 'true');

  // The underlined letter chooses: A for Select All. Focus goes back to the writing area first.
  await page.keyboard.press('a');
  await expect(menu).toBeHidden();
  const selected = await compose.evaluate((area) => {
    const box = area as unknown as { selectionStart: number; selectionEnd: number };
    return box.selectionEnd - box.selectionStart;
  });
  expect(selected).toBe('some words to select'.length);
});

test('Esc closes the right-click menu, leaving the writing area as it was', async () => {
  const compose = page.locator('#compose');
  await compose.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Context menu' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(compose).toBeFocused();
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
