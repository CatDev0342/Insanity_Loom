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

test('a reply written at the end of a long whisper carries the author along, unless they are reading elsewhere', async () => {
  const scroll = page.locator('.whisper-scroll');
  /** Whether the end of the last reply is in view, which is what "watching it being written" means. */
  const replyInView = (): Promise<boolean> =>
    page.evaluate(() => {
      const replies = document.querySelectorAll('.whisper-editor section.reply');
      const last = replies[replies.length - 1];
      const scroller = document.querySelector('.whisper-scroll');
      if (last === undefined || scroller === null) return false;
      return last.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + 80;
    });

  // Writing at the end, where the author is.
  await page.locator('.whisper-editor p').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('A question at the end of a long day.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply').last()).toContainText('You wrote: A question at the end of a long day.');
  // The reply wrote itself under the author's eyes.
  await expect.poll(replyInView).toBe(true);

  // Reading something further up while the next reply is written: the author is left where they are.
  await page.keyboard.type('Another question.');
  await page.keyboard.press('Control+Enter');
  await scroll.evaluate((element) => element.scrollTo({ top: 0 }));
  const whereTheyWere = await scroll.evaluate((element) => element.scrollTop);
  await expect(page.locator('.reply').last()).toContainText('You wrote: Another question.');
  expect(await scroll.evaluate((element) => element.scrollTop)).toBe(whereTheyWere);
});
