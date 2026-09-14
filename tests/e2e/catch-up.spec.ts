// Catching a whisper up with its conversation: what was said while Insanity_Loom was not open is brought in when it
// opens again, and nothing already in the whisper is written twice.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALCOVE, launch, prepareData } from './helpers';

let application: ElectronApplication | undefined;

test.afterEach(async () => {
  const running = application;
  application = undefined;
  await running?.close();
});

async function open(history: number, keepJournal: boolean): Promise<Page> {
  prepareData('fake assistant', { history, keepJournal });
  const started = await launch();
  application = started.application;
  await expect(started.page.locator('#status-text')).toHaveText(/Connected to Fake Assistant/);
  return started.page;
}

async function closeApplication(): Promise<void> {
  const running = application;
  application = undefined;
  await running?.close();
}

test('brings in what was said while the whisper was not open, exactly once', async () => {
  // A first run begins a conversation, so the whisper records which one it is.
  await open(1, false);
  await closeApplication();

  // Opening again resumes that conversation and fills the blank whisper from its history.
  let page = await open(1, true);
  await expect(page.locator('.whisper-host')).toContainText('An earlier answer');
  await closeApplication();

  // Meanwhile another exchange happened elsewhere. Opening again brings in only that one.
  page = await open(2, true);
  await expect(page.getByRole('status').filter({ hasText: 'Brought in' })).toContainText(
    'Brought in 1 section you wrote and 1 reply said while this whisper was not open.',
  );
  const whisper = page.locator('.whisper-host');
  await expect(whisper).toContainText('Question 2');
  await expect(whisper).toContainText('Answer 2');
  // Nothing is doubled: one of each earlier piece, and one of each new one.
  for (const text of ['An earlier question', 'An earlier answer', 'Question 2', 'Answer 2']) {
    const count = await whisper.evaluate(
      (host, needle) => (host.textContent ?? '').split(needle).length - 1,
      text,
    );
    expect(count, text).toBe(1);
  }
});

test('a whisper holding writing is never emptied for a conversation it does not record', async () => {
  const page = await open(1, false);
  const whisper = page.locator('.whisper-editor');
  await whisper.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Writing of my own, in a whisper of my own.');
  const mine = (await page.locator('#whisper-name').textContent()) ?? '';

  // Resuming another conversation while this whisper holds writing.
  await page.keyboard.press('Alt+A');
  await page.keyboard.press('c');
  const resume = page.getByRole('dialog', { name: 'Resume a conversation' });
  await expect(resume).toBeVisible();
  await resume.getByRole('button', { name: /An earlier conversation/ }).click();

  // It is brought into a whisper of its own; the author's writing is not touched.
  await expect(page.locator('#asks')).toContainText('whisper of its own');
  await expect(page.locator('#whisper-name')).not.toHaveText(mine);
  await expect(whisper).not.toContainText('Writing of my own');

  // And what they wrote is still there, in the whisper they were in.
  expect(readFileSync(join(ALCOVE, mine), 'utf8')).toContain('Writing of my own, in a whisper of my own.');
});
