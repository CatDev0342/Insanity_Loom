// Shaping the writing in the running application: the Format menu, its keys, the ticks that follow the caret, and the
// Link dialog.
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

/** Opens the Format menu the way a desktop user does: Alt and its access letter. */
async function openFormatMenu(): Promise<void> {
  await page.keyboard.press('Alt+o');
  await expect(page.getByRole('menu', { name: 'Format' })).toBeVisible();
}

test('Ctrl+B writes in bold, and the Format menu shows it is on', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold words');
  await expect(whisper.locator('strong')).toHaveText('bold words');

  await openFormatMenu();
  await expect(page.getByRole('menuitemcheckbox', { name: /Bold/ })).toHaveAttribute('aria-checked', 'true');
  // Indenting can only act in a list, and says so where there is none.
  await expect(page.getByRole('menuitemcheckbox', { name: /Increase Indent/ })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

test('the Format menu makes a heading, and the caret stays in the writing', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.type('a title');
  await openFormatMenu();
  // The underlined letter chooses: 1 for Heading 1.
  await page.keyboard.press('1');
  await expect(whisper.locator('h1')).toHaveText('a title');
  await page.keyboard.type(', carried on');
  await expect(whisper.locator('h1')).toHaveText('a title, carried on');
});

test('Ctrl+K links the selected writing to the address given', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.type('the loom');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+k');

  const dialog = page.getByRole('dialog', { name: 'Link' });
  await expect(dialog).toBeVisible();
  await page.keyboard.type('example.com/loom');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  const link = whisper.locator('a');
  await expect(link).toHaveText('the loom');
  await expect(link).toHaveAttribute('href', 'https://example.com/loom');
  // The author is back in the whisper, writing where they were.
  await expect(whisper).toBeFocused();
});

test('a Format key does nothing in a dialog, where there is nothing to shape', async () => {
  await page.keyboard.press('Alt+A');
  await page.keyboard.press('o');
  const panel = page.getByRole('dialog', { name: 'Connection Settings' });
  await expect(panel).toBeVisible();
  const folder = panel.getByLabel('Working folder:');
  await folder.click();
  await page.keyboard.press('Control+b');
  // The key was left alone: the dialog is still there, and nothing in the whisper changed.
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.whisper-editor strong')).toHaveCount(0);
});

test('a link to another whisper opens it, and a web link is left to the browser', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.type('the first whisper');
  const first = await page.locator('#whisper-name').textContent();

  // A second whisper, with a link back to the first chosen from the alcove.
  await page.keyboard.press('Control+n');
  await expect(page.locator('#whisper-name')).not.toHaveText(first ?? '');
  await whisper.click();
  await page.keyboard.type('back to where I was');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+k');

  const dialog = page.getByRole('dialog', { name: 'Link' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Or a whisper:').selectOption({ label: (first ?? '').replace(/\.xhtml$/, '') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();

  // Ctrl+click follows it; a plain click would only put the caret in the writing.
  const link = whisper.locator('a');
  await link.click();
  await expect(page.locator('#whisper-name')).not.toHaveText(first ?? '');
  await link.click({ modifiers: ['Control'] });
  await expect(page.locator('#whisper-name')).toHaveText(first ?? '');
  await expect(whisper).toContainText('the first whisper');
});

test('a link can point at a section, and following it goes there', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.type('What the loom is');
  await page.keyboard.press('Control+Alt+2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and a line about it');
  // The heading carries an identity of its own, made from its words.
  await expect(whisper.locator('h2')).toHaveAttribute('id', 'what-the-loom-is');

  await page.keyboard.press('Enter');
  await page.keyboard.type('back up to the top');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Control+k');

  const dialog = page.getByRole('dialog', { name: 'Link' });
  const open = await page.locator('#whisper-name').textContent();
  await dialog.getByLabel('Or a whisper:').selectOption({ label: (open ?? '').replace(/\.xhtml$/, '') });
  await dialog.getByLabel('Section:').selectOption({ label: 'What the loom is' });
  await expect(dialog.getByLabel('Address:')).toHaveValue(/#what-the-loom-is$/);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();

  await whisper.locator('a').click({ modifiers: ['Control'] });
  // The heading a link leads to is marked for a moment, so the author's eye finds it.
  await expect(whisper.locator('h2')).toHaveClass(/is-found/);
});
