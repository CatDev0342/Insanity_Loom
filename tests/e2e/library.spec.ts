// The Library tab and the bar between the panels: what the assistant cited, opened where it stands.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, prepareData } from './helpers';

let application: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  prepareData('fake assistant', { greatHall: true });
  ({ application, page } = await launch());
  await expect(page.locator('#status-text')).toHaveText(/Connected to Fake Assistant/);
});

test.afterEach(async () => {
  await application.close();
});

/** The stand-in assistant replies with what it was sent, so what the author writes is what the reply cites. */
async function ask(text: string): Promise<void> {
  await page.locator('.whisper-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
  await page.keyboard.press('Control+Enter');
}

test('lists what the assistant cited, opens it where it stands, and puts it away again', async () => {
  const library = page.locator('#library-pane');
  await page.getByRole('tab', { name: 'Library' }).click();
  await expect(page.locator('#library-said')).toContainText('Test Library');

  await ask('Look at 40.6.2 and 40.8 for that.');
  await expect(page.locator('.reply')).toHaveCount(1);

  // Both citations are listed, with what stands at them.
  await expect(library.getByRole('button', { name: /40\.6\.2/ })).toBeVisible();
  await expect(library.getByRole('button', { name: /40\.8/ })).toBeVisible();
  await expect(library.getByRole('button', { name: /40\.6\.2/ })).toContainText('Links between whispers');

  // Opening one shows the document, live and editable, with the entry pinned above it.
  await library.getByRole('button', { name: /40\.6\.2/ }).click();
  const writing = library.locator('textarea');
  await expect(writing).toBeVisible();
  await expect(writing).toHaveValue(/40\.6\.2 — Links between whispers/);
  const pinned = library.locator('.library-pinned');
  await expect(pinned).toContainText('40.6.2');

  // Choosing it again puts the document away and the list comes back.
  await pinned.click();
  await expect(writing).toBeHidden();
  await expect(library.getByRole('button', { name: /40\.6\.2/ })).toBeVisible();
});

test('keeps everything cited, turn after turn, and marks them on the bar between the panels', async () => {
  await page.getByRole('tab', { name: 'Library' }).click();
  await ask('First, see 40.6.2.');
  await expect(page.locator('.reply')).toHaveCount(1);
  await ask('Then see 40.8.');
  await expect(page.locator('.reply')).toHaveCount(2);

  // The list keeps what was cited in both turns, in the order cited.
  const entries = page.locator('#library-pane .library-entry');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText('40.6.2');
  await expect(entries.nth(1)).toContainText('40.8');

  // The bar between the panels carries a mark for each turn that cited something.
  await expect(page.locator('#reference-bar .reference-mark')).toHaveCount(2);
});

test('says so plainly when no GreatHall is open', async () => {
  await application.close();
  prepareData('fake assistant');
  ({ application, page } = await launch());
  await page.getByRole('tab', { name: 'Library' }).click();
  await expect(page.locator('#library-said')).toContainText('No GreatHall is open');
});
