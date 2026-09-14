// The assistant's way of working, chosen in the status bar: whether it asks the author to approve each step, or
// decides by itself. The choice is remembered for later conversations and later runs.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, prepareData } from './helpers';

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
  await expect(started.page.locator('#status-text')).toHaveText(/Connected to Fake Assistant/);
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
