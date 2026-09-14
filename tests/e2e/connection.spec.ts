// Assistant ▸ Connection Settings: every option on show, the command it will run, a test before saving, and the
// panel opening by itself on the first start.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, FAKE_ASSISTANT, FAKE_CONNECTION, launch, prepareData, REPOSITORY, waitUntilConnected } from './helpers';

let application: ElectronApplication;
let page: Page;

test.afterEach(async () => {
  await application.close();
});

test('opens by itself on the first start, and connects once filled in', async () => {
  prepareData('first start');
  ({ application, page } = await launch());

  const panel = page.getByRole('dialog', { name: 'Connection Settings' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Nothing entered here leaves this computer');
  // Nothing is filled in yet, so nothing can be saved or tested.
  await expect(panel.getByRole('button', { name: 'OK' })).toBeDisabled();
  await expect(panel.getByRole('alert').filter({ hasText: 'The container must be named.' })).toBeVisible();

  // Alt+M: "Directly on this computer", the way a desktop dialog's access keys work.
  await page.keyboard.press('Alt+M');
  await expect(panel.getByLabel('Directly on this computer')).toBeChecked();
  await expect(panel.getByLabel('Container:')).toBeDisabled();

  await panel.getByLabel('Working folder:').fill(REPOSITORY);
  await panel.getByLabel('Host program:').fill(process.execPath);
  await panel.getByLabel('Arguments, one per line:').fill(FAKE_ASSISTANT);
  await expect(panel.locator('.panel-preview')).toContainText('fake-assistant.mjs');

  await panel.getByRole('button', { name: 'Test Connection' }).click();
  await expect(panel.getByRole('status')).toHaveText('Fake Assistant answered on this computer.');

  await panel.getByRole('button', { name: 'OK' }).click();
  await expect(panel).toBeHidden();
  await waitUntilConnected(page);
  await expect(page.locator('#status-text')).toHaveText('Connected to Fake Assistant on this computer.');

  const saved = JSON.parse(readFileSync(join(DATA, 'settings.json'), 'utf8')) as { connection: { hostArguments: string[] } };
  expect(saved.connection.hostArguments).toEqual([FAKE_ASSISTANT]);
});

test('shows the saved settings, and the Docker command they would run', async () => {
  prepareData('fake assistant');
  ({ application, page } = await launch());
  await waitUntilConnected(page);

  await page.keyboard.press('Alt+A');
  await page.keyboard.press('o');
  const panel = page.getByRole('dialog', { name: 'Connection Settings' });
  await expect(panel.getByLabel('Working folder:')).toHaveValue(FAKE_CONNECTION.workingFolder);

  await panel.getByLabel('In a Docker container on this computer').check();
  await panel.getByLabel('Container:').fill('my-container');
  await expect(panel.locator('.panel-preview')).toContainText('docker exec -i -w');
  await expect(panel.locator('.panel-preview')).toContainText('my-container');

  // Cancel keeps what was saved.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  const saved = JSON.parse(readFileSync(join(DATA, 'settings.json'), 'utf8')) as { connection: { place: string } };
  expect(saved.connection.place).toBe('local');
});
