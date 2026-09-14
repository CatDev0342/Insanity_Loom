// A long whisper — a day's conversation, hundreds of sections — used as the author uses it. What is measured here is
// what they would feel: how long after they stop typing the words are on disk, and how long the program takes to find
// something in it. The bounds are generous: this is here to catch something going badly wrong, not to hold a number.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALCOVE, DATA, launch, prepareData } from './helpers';

/** How many sections the whisper holds: more than a long day of writing. */
const SECTIONS = 400;

/** How long the words may take to reach the disk after the author stops typing, in milliseconds. */
const SAVED_WITHIN_MS = 4000;

/** How long finding writing in the whole whisper may take, in milliseconds. */
const FOUND_WITHIN_MS = 4000;

const WHISPER_NAME = '2026-09-14 1200 A long conversation.xhtml';

let application: ElectronApplication;
let page: Page;

function longWhisper(): string {
  const parts: string[] = [];
  for (let section = 0; section < SECTIONS; section++) {
    parts.push(`<h2 id="section-${section}">Section ${section}</h2>`);
    parts.push(`<p>The author wrote a few lines here about the loom, number ${section}, at some length.</p>`);
    parts.push(`<hr data-section-id="s${section}" />`);
    parts.push(
      `<section data-reply-id="r${section}" data-state="finished" class="reply" data-author="assistant">` +
        `<p>A reply of some length, number ${section}, with a little <strong>emphasis</strong>.</p>` +
        '<ul><li><p>one</p></li><li><p>two</p></li></ul></section>',
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml" lang="en">',
    '<head><meta charset="UTF-8" /><title>A long conversation</title>',
    '<meta name="generator" content="Insanity_Loom" />',
    '<meta name="insanity-loom-conversation" content="" /></head>',
    `<body><article class="whisper">${parts.join('')}<p></p></article></body>`,
    '</html>',
    '',
  ].join('\n');
}

test.beforeEach(async () => {
  prepareData('fake assistant');
  mkdirSync(ALCOVE, { recursive: true });
  const path = join(ALCOVE, WHISPER_NAME);
  writeFileSync(path, longWhisper());
  // The whisper last open is the long one, so the program opens it as it would any other.
  mkdirSync(join(DATA, 'Journal'), { recursive: true });
  writeFileSync(join(DATA, 'Journal', 'whisper.json'), `${JSON.stringify({ path })}\n`);
  ({ application, page } = await launch());
  await expect(page.locator('#whisper-name')).toHaveText(WHISPER_NAME);
});

test.afterEach(async () => {
  await application.close();
});

test('a long whisper is written in, saved and searched without the author waiting', async () => {
  const whisper = page.locator('.whisper-editor');
  const path = join(ALCOVE, WHISPER_NAME);
  await expect(whisper).toContainText('Section 399');

  // Writing at the end of it, as the author does all day.
  await page.locator('.whisper-editor p').last().click();
  const typed = `a new thought ${Date.now()}`;
  await page.keyboard.type(typed);

  const startedSaving = Date.now();
  await expect.poll(() => readFileSync(path, 'utf8').includes(typed), { timeout: SAVED_WITHIN_MS }).toBe(true);
  const savedIn = Date.now() - startedSaving;

  // Finding something across the whole of it.
  await page.keyboard.press('Control+f');
  const startedFinding = Date.now();
  // The heading of the last section, which is written once in the whole whisper.
  await page.keyboard.type('Section 399');
  await expect(page.locator('#find-said')).toHaveText('1 of 1', { timeout: FOUND_WITHIN_MS });
  const foundIn = Date.now() - startedFinding;

  // Written onto the run itself, so the numbers can be read without its logs and watched as the program grows.
  const measured = `${SECTIONS} sections: saved in ${savedIn}ms, found in ${foundIn}ms`;
  test.info().annotations.push({ type: 'long whisper', description: measured });
  if (process.env['GITHUB_ACTIONS'] === 'true') console.log(`::notice title=Long whisper::${measured}`);
  expect(savedIn).toBeLessThan(SAVED_WITHIN_MS);
  expect(foundIn).toBeLessThan(FOUND_WITHIN_MS);
});

test('a reply grows upward, leaving the line the author is writing on where it was', async () => {
  const whisper = page.locator('.whisper-editor');
  /** Where the line the author is writing on sits on the screen. */
  const whereTheWritingIs = (): Promise<number> =>
    page.evaluate(() => {
      const blocks = document.querySelectorAll('.whisper-editor > *');
      const last = blocks[blocks.length - 1];
      return last === undefined ? 0 : Math.round(last.getBoundingClientRect().top);
    });

  await whisper.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('A question at the end of a long day.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply').last()).toContainText('You wrote:');
  const wasAt = await whereTheWritingIs();

  // A second turn, whose reply is written while the author watches.
  await page.keyboard.type('And another question, longer than the first one was.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply').last()).toContainText('And another question');

  // The reply grew above it: the place the author writes has not moved on the screen.
  const nowAt = await whereTheWritingIs();
  expect(Math.abs(nowAt - wasAt)).toBeLessThan(24);
});

test('a reply written while the author reads elsewhere leaves them where they are', async () => {
  const scroll = page.locator('.whisper-scroll');
  await page.locator('.whisper-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('A question asked before going for a read.');
  await page.keyboard.press('Control+Enter');

  await scroll.evaluate((element) => element.scrollTo({ top: 0 }));
  const whereTheyWere = await scroll.evaluate((element) => element.scrollTop);
  await expect(page.locator('.reply').last()).toContainText('You wrote: A question asked before going for a read.');
  expect(await scroll.evaluate((element) => element.scrollTop)).toBe(whereTheyWere);
});
