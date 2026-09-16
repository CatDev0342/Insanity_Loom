// The Library tab and the bar between the panels: what the assistant cited, opened where it stands.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, prepareData, waitUntilConnected } from './helpers';

let application: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  prepareData('fake assistant', { greatHall: true });
  ({ application, page } = await launch());
  await waitUntilConnected(page);
  // The panel must be there to be used: a smaller window narrows it, and only a tiny one puts it away.
  await expect(page.locator('#thoughts')).toBeVisible();
});

test.afterEach(async () => {
  await application.close();
});

/**
 * The addresses listed in the Library tab, in order. Asserted instead of a count: a list that holds the wrong thing
 * then says what it holds, which a count cannot — this failed once on CI with two entries where one was expected,
 * and nothing in the failure said which second address had appeared.
 */
async function citedAddresses(): Promise<readonly string[]> {
  const entries = await page.locator('#library-pane .library-entry').allInnerTexts();
  return entries.map((entry) => entry.split('\n')[0]?.trim() ?? '');
}

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
  await expect.poll(citedAddresses).toEqual(['40.6.2', '40.8']);

  // The bar between the panels carries a mark for each turn that cited something.
  await expect(page.locator('#reference-bar .reference-mark')).toHaveCount(2);
});

test('shows what this whisper cited, and what another whisper cited when it is opened', async () => {
  await page.getByRole('tab', { name: 'Library' }).click();
  await ask('The first whisper, about 40.6.2.');
  await expect(page.locator('.reply')).toHaveCount(1);
  await expect.poll(citedAddresses).toEqual(['40.6.2']);

  // Another whisper is another conversation: its own citations, and none of the last one's.
  await page.keyboard.press('Control+n');
  await expect.poll(citedAddresses).toEqual([]);
  await ask('The second whisper, about 40.8.');
  await expect(page.locator('.reply')).toHaveCount(1);
  await expect.poll(citedAddresses).toEqual(['40.8']);
});

test('says so plainly when no GreatHall is open', async () => {
  await application.close();
  prepareData('fake assistant');
  ({ application, page } = await launch());
  await page.getByRole('tab', { name: 'Library' }).click();
  await expect(page.locator('#library-said')).toContainText('No GreatHall is open');
});

test('Find in Files searches the hall it belongs to, library and all', async () => {
  // A window of its own, which the author may leave open beside their writing.
  await page.keyboard.press('Control+Shift+g');
  const window = await application.waitForEvent('window');
  await expect(window.locator('#find-in-files')).toBeVisible();
  await expect(window.getByLabel("Look in the GreatHall's library as well")).toBeChecked();

  await window.getByLabel('Find what:').fill('Links between whispers');
  await window.getByRole('button', { name: 'Find All' }).click();
  await expect(window.getByRole('status')).toContainText('in 1 document');
  await expect(window.getByRole('listbox')).toContainText('library');

  // Choosing a result takes the program's own window there; the find window stays, with its results.
  await window.getByRole('listbox').selectOption({ index: 1 });
  await window.getByRole('button', { name: 'Go To' }).click();
  await expect(page.locator('#library-pane textarea')).toHaveValue(/40\.6 — THE WIKI/);
  await expect(page.locator('#library-pane .library-pinned')).toContainText('40');
  await expect(window.getByRole('listbox')).toContainText('library');
});

test('the editing shortcuts are one stop for the keyboard, with the arrows moving along them', async () => {
  const toolbar = page.getByRole('toolbar', { name: 'Editing' });
  const bold = toolbar.getByRole('button', { name: 'Bold' });
  const italic = toolbar.getByRole('button', { name: 'Italic' });

  await bold.focus();
  await expect(bold).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(italic).toBeFocused();
  await page.keyboard.press('End');
  await expect(toolbar.getByRole('button', { name: 'Section isolation' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(bold).toBeFocused();

  // One stop: Tab from the strip leaves it rather than walking every button.
  await page.keyboard.press('Tab');
  await expect(bold).not.toBeFocused();
  await expect(italic).not.toBeFocused();
});

test('a smaller window keeps every control within reach', async () => {
  // A laptop screen, not a build machine's: the writing narrows, and nothing must be pushed out of the window.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 700));
  await expect(page.locator('#toolbar')).toBeVisible();

  // The panels are still there, narrower.
  await expect(page.locator('#navigation')).toBeVisible();
  await expect(page.locator('#thoughts')).toBeVisible();

  // The editing shortcuts, the status bar's buttons, and the find bar's own buttons can all still be pressed.
  await expect(page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: 'Bold' })).toBeVisible();
  await expect(page.locator('#connection-settings')).toBeVisible();
  await page.locator('.whisper-editor').click();
  await page.keyboard.press('Control+h');
  const bar = page.getByRole('search', { name: 'Find in this whisper' });
  await expect(bar.getByRole('button', { name: 'Replace All' })).toBeVisible();
  await page.keyboard.press('Escape');

  // And the advanced find window, which stands in a window of its own, holds its own controls within it.
  await page.keyboard.press('Control+Shift+g');
  const window = await application.waitForEvent('window');
  await expect(window.getByRole('button', { name: 'Find All' })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Close' })).toBeVisible();
  const fits = await window.evaluate(() => document.body.scrollWidth <= globalThis.innerWidth + 1);
  expect(fits).toBe(true);
});

test('the three sections divide the window, and the bars between them move it', async () => {
  const navigation = page.locator('#navigation');
  const whisper = page.locator('.whisper-editor');

  // The writing fills the room between the panels rather than sitting in a column of its own.
  const room = await page.evaluate(() => {
    const writing = document.querySelector('.whisper-editor');
    const middle = document.querySelector('.middle');
    if (writing === null || middle === null) return 0;
    return middle.getBoundingClientRect().width - writing.getBoundingClientRect().width;
  });
  expect(room).toBeLessThan(8);

  // Dragging a bar gives the room to one section and takes it from another.
  const wasWide = (await navigation.boundingBox())?.width ?? 0;
  const splitter = page.locator('#left-splitter');
  const bar = await splitter.boundingBox();
  await page.mouse.move((bar?.x ?? 0) + 2, (bar?.y ?? 0) + 100);
  await page.mouse.down();
  await page.mouse.move((bar?.x ?? 0) + 120, (bar?.y ?? 0) + 100, { steps: 8 });
  await page.mouse.up();
  const nowWide = (await navigation.boundingBox())?.width ?? 0;
  expect(nowWide).toBeGreaterThan(wasWide + 60);

  // The keyboard moves it too: it is a separator, and says how wide the panel now is.
  await splitter.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(splitter).toHaveAttribute('aria-valuenow', /\d+/);
  expect((await navigation.boundingBox())?.width ?? 0).toBeLessThan(nowWide);

  // And the writing keeps whatever the panels do not take.
  await expect(whisper).toBeVisible();
});
