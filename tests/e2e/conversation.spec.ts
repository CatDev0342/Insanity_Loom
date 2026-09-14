// The conversation, end to end: the author writes, finishes a section with "---", and the assistant's reply is
// woven into the document. A stand-in assistant (tests/fixtures/fake-assistant.mjs) answers, so nothing depends on
// a real one being reachable.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, launch, prepareData } from './helpers';

let application: ElectronApplication;
let page: Page;

async function start(): Promise<void> {
  ({ application, page } = await launch());
  await expect(page.locator('#status-text')).toHaveText(/Connected to Fake Assistant/);
}

test.beforeEach(async () => {
  prepareData('fake assistant');
  await start();
});

test.afterEach(async () => {
  await application.close();
});

test('a line of --- sends the section above it, and the reply is woven in below', async () => {
  const compose = page.locator('#compose');
  await compose.click();
  await page.keyboard.type('Hello, loom.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('---');
  await page.keyboard.press('Enter');

  await expect(compose).toHaveValue('');
  await expect(page.locator('.by-author')).toHaveText('Hello, loom.');
  await expect(page.locator('.by-assistant .reply-text')).toHaveText('You wrote: Hello, loom.');
  await expect(page.locator('.loom-divider')).toHaveCount(2);
});

test('--- in the middle of a line is ordinary writing', async () => {
  const compose = page.locator('#compose');
  await compose.click();
  await page.keyboard.type('before --- after');
  await page.keyboard.press('Enter');
  await expect(compose).toHaveValue('before --- after\n');
  await expect(page.locator('.by-author')).toHaveCount(0);
});

test('a permission request waits for the author, and their choice goes back', async () => {
  await page.locator('#compose').click();
  await page.keyboard.type('please ask permission');
  await page.keyboard.press('Control+Enter');

  const card = page.getByRole('group', { name: 'Permission request' });
  await expect(card).toContainText('Write a file called notes.txt');
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(card).toContainText('You chose: Allow once');
  await expect(page.locator('.by-assistant .reply-text')).toHaveText('Permission answer: yes');
});

test('Esc stops a reply being written', async () => {
  await page.locator('#compose').click();
  await page.keyboard.type('write something slow');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.by-assistant .reply-text')).toContainText('still writing');

  await page.keyboard.press('Escape');
  await expect(page.locator('.reply-ending')).toHaveText('Stopped.');
});

test('unsent writing survives closing the window, and the conversation is resumed', async () => {
  await page.locator('#compose').click();
  await page.keyboard.type('not sent yet');
  await expect
    .poll(() => {
      try {
        return readFileSync(join(DATA, 'Journal', 'draft.txt'), 'utf8');
      } catch {
        return '';
      }
    })
    .toBe('not sent yet');

  await application.close();
  await start();
  await expect(page.locator('#compose')).toHaveValue('not sent yet');
  // The last conversation is resumed: its history is replayed into the document.
  await expect(page.locator('.by-author')).toHaveText('An earlier question');
  await expect(page.locator('.by-assistant .reply-text')).toHaveText('An earlier answer');
});

test('Assistant ▸ Resume Conversation lists earlier conversations and replays the one chosen', async () => {
  await page.keyboard.press('Alt+A');
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: 'Resume a conversation' });
  await dialog.getByRole('option', { name: /An earlier conversation/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.by-assistant .reply-text')).toHaveText('An earlier answer');
});
