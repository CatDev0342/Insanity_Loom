// Whispers as files in an alcove: one file per conversation, named after it, saved as it is written.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ALCOVE, DATA, launch, prepareData, waitUntilConnected } from './helpers';

let application: ElectronApplication | undefined;
let page: Page;

test.beforeEach(async () => {
  prepareData('fake assistant');
  const started = await launch();
  application = started.application;
  page = started.page;
  await waitUntilConnected(page);
});

test.afterEach(async () => {
  const running = application;
  application = undefined;
  await running?.close();
});

const whispers = (): string[] => readdirSync(ALCOVE).filter((name) => name.endsWith('.xhtml')).sort();

test('a whisper is a file in the alcove, named after its conversation, holding what was written', async () => {
  await expect.poll(() => whispers().length).toBe(1);

  await page.locator('.whisper-host').click();
  await page.keyboard.type('Kept in a file.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply')).toContainText('You wrote: Kept in a file.');

  // The conversation was given a title, so its file is named after it, keeping the date it began.
  await expect.poll(() => whispers()[0] ?? '').toMatch(/^\d{4}-\d{2}-\d{2} \d{4} A named conversation\.xhtml$/);
  await expect(page.locator('#whisper-name')).toContainText('A named conversation');

  const inTheFile = (): string => readFileSync(join(ALCOVE, whispers()[0] ?? ''), 'utf8');
  await expect.poll(inTheFile).toContain('Kept in a file.');
  expect(inTheFile()).toContain('You wrote: Kept in a file.');
  // It is a whole XHTML page, which a browser can open.
  expect(inTheFile()).toContain('<html xmlns="http://www.w3.org/1999/xhtml"');
});

test('File ▸ New Whisper begins another whisper, leaving the first where it is', async () => {
  await page.locator('.whisper-host').click();
  await page.keyboard.type('The first whisper.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply')).toContainText('You wrote: The first whisper.');
  await expect.poll(() => whispers().length).toBe(1);
  const first = whispers()[0] ?? '';

  await page.keyboard.press('Alt+F');
  await page.keyboard.press('n');
  await expect.poll(() => whispers().length).toBe(2);
  await expect(page.locator('.whisper-host')).not.toContainText('The first whisper.');

  // The first whisper still holds what was written in it.
  expect(readFileSync(join(ALCOVE, first), 'utf8')).toContain('The first whisper.');

  await page.locator('.whisper-host').click();
  await page.keyboard.type('The second whisper.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply')).toContainText('You wrote: The second whisper.');
  await expect
    .poll(() => whispers().map((name) => readFileSync(join(ALCOVE, name), 'utf8').includes('The second whisper.')).filter(Boolean).length)
    .toBe(1);
});

test('a copy is kept before anything replaces what is in a whisper', async () => {
  const kept = join(DATA, 'Kept');
  rmSync(kept, { recursive: true, force: true });

  await page.locator('.whisper-host').click();
  await page.keyboard.type('Writing that exists nowhere else.');
  await expect.poll(() => whispers().length).toBe(1);

  // A new whisper puts something else where this writing was: a copy is kept first.
  await page.keyboard.press('Alt+F');
  await page.keyboard.press('n');
  await expect.poll(() => whispers().length).toBe(2);
  await expect
    .poll(() => (existsSync(kept) ? readdirSync(kept).filter((name) => name.endsWith('.xhtml')) : []))
    .not.toHaveLength(0);

  const copies = readdirSync(kept).filter((name) => name.endsWith('.xhtml'));
  const inside = readFileSync(join(kept, copies[0] ?? ''), 'utf8');
  expect(inside).toContain('Writing that exists nowhere else.');
  // And the copy says when it was kept and why.
  expect(copies[0]).toMatch(/— \d{4}-\d{2}-\d{2} \d{6} — before a new whisper\.xhtml$/);
});
