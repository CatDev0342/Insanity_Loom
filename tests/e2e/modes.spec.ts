// The assistant's way of working, chosen in the status bar: whether it asks the author to approve each step, or
// decides by itself. The choice is remembered for later conversations and later runs.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, prepareData, waitUntilConnected } from './helpers';

let application: ElectronApplication | undefined;

test.afterEach(async () => {
  const running = application;
  application = undefined;
  await running?.close();
});

async function open(keepJournal: boolean): Promise<Page> {
  prepareData('fake assistant', { keepJournal });
  const started = await launch();
  application = started.application;
  await waitUntilConnected(started.page);
  return started.page;
}

test('Manual asks; Auto does not; and the choice is still there after a restart', async () => {
  let page = await open(false);
  const mode = page.getByLabel('Mode:');
  await expect(mode).toHaveValue('default');

  // Manual: the author is asked.
  await page.locator('.whisper-host').click();
  await page.keyboard.type('please ask permission');
  await page.keyboard.press('Control+Enter');
  const card = page.getByRole('group', { name: 'Permission request' });
  await expect(card).toContainText('Write a file called notes.txt');
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(page.locator('.reply')).toContainText('Permission answer: yes');

  // Auto: nothing is asked.
  await mode.selectOption('auto');
  await expect(mode).toHaveAttribute('data-asking', 'less');
  await page.locator('.whisper-host').click();
  await page.keyboard.press('End');
  await page.keyboard.type('please ask permission again');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.reply').last()).toContainText('decided by the assistant');
  await expect(page.getByRole('group', { name: 'Permission request' })).toHaveCount(0);

  // Remembered: a new run of Insanity_Loom begins in the way of working last chosen.
  const running = application;
  application = undefined;
  await running?.close();
  page = await open(true);
  await expect(page.getByLabel('Mode:')).toHaveValue('auto');
});

test('the settings the assistant offers stand beside the way of working, and the mode is not shown twice', async () => {
  const page = await open(false);

  // An assistant that offers settings offers the way of working among them as well as as a mode. Shown as both, the
  // status bar carried two Mode choosers side by side (the designer, 2026-Sep-16).
  await expect(page.getByLabel('Mode:')).toHaveCount(1);

  // What is worth a glance and had no way of being seen at all: which model answers, and how hard it thinks.
  const model = page.getByLabel('Model:');
  const thinking = page.getByLabel('Thinking:');
  await expect(model).toHaveValue('fake-opus');
  await expect(thinking).toHaveValue('medium');

  // Setting one can move another — the quick model does not think hard — and what is shown is what came back.
  await model.selectOption('fake-haiku');
  await expect(thinking).toHaveValue('low');
});
