// The whisper, end to end: the author writes in one rich-text document, finishes a section with "---", and the
// assistant's reply is woven in right after it. A stand-in assistant (tests/fixtures/fake-assistant.mjs) answers, so
// nothing depends on a real one being reachable.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALCOVE, launch, prepareData } from './helpers';

let application: ElectronApplication;
let page: Page;

async function start(): Promise<void> {
  ({ application, page } = await launch());
  await expect(page.locator('#status-text')).toHaveText(/Connected to Fake Assistant/);
}

const whisper = (): ReturnType<Page['locator']> => page.locator('.whisper-editor');
const replies = (): ReturnType<Page['locator']> => page.locator('.whisper-editor section.reply');

async function finishSection(text: string): Promise<void> {
  await whisper().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
  await page.keyboard.press('Control+Enter');
}

test.beforeEach(async () => {
  prepareData('fake assistant');
  await start();
});

test.afterEach(async () => {
  await application.close();
});

test('Ctrl+Enter closes the turn and the reply follows the line that closed it', async () => {
  await finishSection('Hello, loom.');
  await expect(replies()).toHaveCount(1);
  await expect(replies().first()).toHaveText('You wrote: Hello, loom.');
  await expect(replies().first()).toHaveAttribute('data-state', 'finished');
  await expect(whisper().locator('hr')).toHaveCount(1);
  // The reply sits right after the rule of its section.
  const order = await whisper().evaluate((element) => [...element.children].map((child) => child.tagName.toLowerCase()));
  expect(order.slice(0, 3)).toEqual(['p', 'hr', 'section']);
});

test('three hyphens are ordinary writing, and Enter is ordinary Enter', async () => {
  await whisper().click();
  await page.keyboard.type('---');
  await page.keyboard.press('Enter');
  await page.keyboard.type('still writing');
  await expect(whisper().locator('hr')).toHaveCount(0);
  await expect(replies()).toHaveCount(0);
  await expect(whisper()).toContainText('---');
});

test('each turn is numbered, with the local date and time it was taken', async () => {
  await finishSection('The first thing.');
  await expect(replies()).toHaveCount(1);
  await finishSection('The second thing.');
  await expect(replies()).toHaveCount(2);

  const rules = whisper().locator('hr');
  await expect(rules.nth(0)).toHaveAttribute('data-turn', '1');
  await expect(rules.nth(1)).toHaveAttribute('data-turn', '2');
  // Written along the line, where the author can read it.
  const label = await rules.nth(1).evaluate((element) => getComputedStyle(element, '::after').content);
  expect(label).toContain('Turn 2');
});

test('a permission request waits for the author above the whisper, and their choice goes back', async () => {
  await whisper().click();
  await page.keyboard.type('please ask permission');
  await page.keyboard.press('Control+Enter');

  const ask = page.getByRole('group', { name: 'Permission request' });
  await expect(ask).toContainText('Write a file called notes.txt');
  await ask.getByRole('button', { name: 'Allow once' }).click();
  await expect(ask).toBeHidden();
  await expect(replies().first()).toHaveText('Permission answer: yes');
});

test('Esc stops a reply being written, and it is marked as stopped', async () => {
  await whisper().click();
  await page.keyboard.type('write something slow');
  await page.keyboard.press('Control+Enter');
  await expect(replies().first()).toContainText('still writing');
  await page.keyboard.press('Escape');
  await expect(replies().first()).toHaveAttribute('data-state', 'stopped');
});

test("the author's Ctrl+Z never takes back the assistant's reply", async () => {
  await finishSection('A question.');
  await expect(replies().first()).toHaveAttribute('data-state', 'finished');
  await page.keyboard.type('My follow-up');
  await expect(whisper()).toContainText('My follow-up');
  await page.keyboard.press('Control+Z');
  await expect(whisper()).not.toContainText('My follow-up');
  await expect(replies().first()).toHaveText('You wrote: A question.');
});

test("a finished reply is the author's to edit", async () => {
  await finishSection('Edit me.');
  await expect(replies().first()).toHaveAttribute('data-state', 'finished');
  await replies().first().getByText('You wrote: Edit me.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' (edited)');
  await expect(replies().first()).toHaveText('You wrote: Edit me. (edited)');
});

test('the whisper survives closing the window, without its history being written in twice', async () => {
  await finishSection('Remember this.');
  await expect(replies().first()).toHaveAttribute('data-state', 'finished');
  await page.keyboard.type('not sent yet');
  await expect
    .poll(() => {
      try {
        const whispers = readdirSync(ALCOVE).filter((name) => name.endsWith('.xhtml'));
        return whispers.map((name) => readFileSync(join(ALCOVE, name), 'utf8')).join('');
      } catch {
        return '';
      }
    })
    .toContain('not sent yet');

  await application.close();
  await start();
  await expect(whisper()).toContainText('Remember this.');
  await expect(whisper()).toContainText('not sent yet');
  await expect(replies()).toHaveCount(1);
  // The conversation resumed is the one the whisper already records: its history is not written in again.
  await expect(whisper()).not.toContainText('An earlier question');
});

test('Assistant ▸ Resume Conversation fills a fresh whisper from the conversation chosen', async () => {
  await page.keyboard.press('Alt+A');
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: 'Resume a conversation' });
  await dialog.getByRole('option', { name: /An earlier conversation/ }).click();
  await expect(dialog).toBeHidden();
  await expect(whisper().locator('p').first()).toHaveText('An earlier question');
  await expect(replies().first()).toHaveText('An earlier answer');
});

test('the status bar says how full the assistant is, and offers to make room', async () => {
  const context = page.locator('#context');
  const compact = page.locator('#compact');
  await expect(compact).toBeVisible();
  await expect(context).toBeHidden();

  await finishSection('The first thing.');
  await expect(replies()).toHaveCount(1);
  await expect(context).toBeVisible();
  await expect(context).toContainText('10% of context · 20k of 200k');

  await finishSection('The second thing.');
  await expect(replies()).toHaveCount(2);
  await expect(context).toContainText('20% of context · 40k of 200k');

  // Making room: what the assistant says while doing it is thinking, not a reply, and the whisper is untouched.
  await compact.click();
  await expect(context).toContainText('5% of context · 10k of 200k');
  await expect(replies()).toHaveCount(2);
  await expect(page.getByLabel("The assistant's thinking")).toContainText('Kept what mattered.');
});
