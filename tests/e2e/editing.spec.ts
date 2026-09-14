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

  const bar = page.getByRole('search', { name: 'Find in this whisper' });
  // Put away until it is asked for: the hidden attribute must mean hidden, whatever the styling says.
  await expect(bar).toBeHidden();
  await page.keyboard.press('Control+f');
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

test('Ctrl+H writes something else in place of what was found', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.type('one loom, two loom, three looms');

  await page.keyboard.press('Control+h');
  const bar = page.getByRole('search', { name: 'Find in this whisper' });
  await expect(bar).toBeVisible();
  await page.keyboard.type('loom');
  await expect(page.locator('#find-said')).toHaveText('1 of 3');

  await bar.getByLabel('Replace with:').fill('thread');
  await bar.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(whisper).toContainText('one thread, two loom, three looms');

  await bar.getByRole('button', { name: 'Replace All' }).click();
  await expect(whisper).toContainText('one thread, two thread, three threads');
  // One change the author can take back at once.
  await whisper.click();
  await page.keyboard.press('Control+z');
  await expect(whisper).toContainText('one thread, two loom, three looms');
});

test('the editing shortcuts along the top act on the writing and follow the caret', async () => {
  const whisper = page.locator('.whisper-editor');
  const toolbar = page.getByRole('toolbar', { name: 'Editing' });
  await expect(toolbar).toBeVisible();

  await whisper.click();
  await page.keyboard.type('a line to shape');
  await page.keyboard.press('Control+a');
  await toolbar.getByRole('button', { name: 'Bold' }).click();
  await expect(whisper.locator('strong')).toHaveText('a line to shape');
  // The button says what the caret is standing in, and the author is still in their writing.
  await expect(toolbar.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await expect(whisper).toBeFocused();

  await toolbar.getByRole('button', { name: 'Heading 2' }).click();
  await expect(whisper.locator('h2')).toHaveText('a line to shape');
  await expect(toolbar.getByRole('button', { name: 'Heading 2' })).toHaveAttribute('aria-pressed', 'true');
});

test('the panel on the left lists the headings and turns of the whisper, and goes to them', async () => {
  const whisper = page.locator('.whisper-editor');
  // The panel itself, not its tab or the pane the tab names, each of which answers to the same word.
  const navigation = page.locator('#navigation');
  await expect(navigation).toBeVisible();

  await whisper.click();
  await page.keyboard.type('What the loom is');
  await page.keyboard.press('Control+Alt+2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A question.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply')).toHaveCount(1);

  await expect(navigation.getByRole('button', { name: 'What the loom is' })).toBeVisible();
  await expect(navigation.getByRole('button', { name: /^Turn 1/ })).toBeVisible();
  await navigation.getByRole('button', { name: 'What the loom is' }).click();
  // Choosing leaves the author in their writing rather than in the panel.
  await expect(navigation.getByRole('button', { name: 'What the loom is' })).not.toBeFocused();
});

test("the assistant's thinking is shown beside the whisper, not in it", async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.type('please think about it');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply')).toHaveCount(1);

  const thinking = page.getByLabel("The assistant's thinking", { exact: true });
  await expect(thinking).toContainText('Turn 1');
  await expect(thinking.locator('.thought')).toContainText('Thinking about');
  // What was thought is not in the whisper: the whisper is the author's prose.
  await expect(whisper).not.toContainText('Thinking about');
});

test('Section Isolation keeps Select All inside the turn the author is in', async () => {
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.type('The first question.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply')).toHaveCount(1);
  await page.keyboard.type('What I am writing now.');

  const selected = (): Promise<string> => page.evaluate(() => String(globalThis.getSelection() ?? ''));

  // Off, as it has always been: Select All takes the whole whisper.
  await page.keyboard.press('Control+a');
  expect(await selected()).toContain('The first question.');

  // On: it takes the turn the author is in, and nothing before it.
  await page.keyboard.press('Control+Shift+i');
  await expect(page.locator('#isolation')).toBeVisible();
  await whisper.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+a');
  const inside = await selected();
  expect(inside).toContain('What I am writing now.');
  expect(inside).not.toContain('The first question.');

  // Off again, and the whole whisper once more.
  await page.keyboard.press('Control+Shift+i');
  await expect(page.locator('#isolation')).toBeHidden();
  await whisper.click();
  await page.keyboard.press('Control+a');
  expect(await selected()).toContain('The first question.');
});
