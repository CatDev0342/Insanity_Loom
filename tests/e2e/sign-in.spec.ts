// Signing the assistant in from Insanity_Loom: only ever at the author's request, never by itself.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, prepareData, waitUntilConnected } from './helpers';

let application: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  prepareData('fake assistant, signed out');
  ({ application, page } = await launch());
});

test.afterEach(async () => {
  await application.close();
});

test('a signed-out assistant is shown in the status bar, and nothing opens by itself', async () => {
  await expect(page.locator('#status-text')).toHaveText(/is not signed in/);
  await expect(page.getByRole('button', { name: 'Sign In…' })).toBeVisible();
  // Give anything that might open by itself the chance to, then check nothing did.
  await page.waitForTimeout(1000);
  await expect(page.getByRole('dialog', { name: 'Sign In' })).toBeHidden();
});

test('signing in with the code from the sign-in page connects', async () => {
  await expect(page.locator('#status-text')).toHaveText(/is not signed in/);
  await page.getByRole('button', { name: 'Sign In…' }).click();

  const panel = page.getByRole('dialog', { name: 'Sign In' });
  await expect(panel.getByLabel('Fake Account')).toBeChecked();
  await panel.getByRole('button', { name: 'Start Sign-In' }).click();
  await expect(panel.getByLabel('Sign-in page:')).toHaveValue('https://claude.com/fake/oauth/authorize?code=true&state=fake');

  // The browser is never opened in a test; the author would press Open Sign-In Page here.
  await panel.getByLabel('Code from the page:').fill('good-code');
  await panel.getByRole('button', { name: 'Finish Sign-In' }).click();
  await expect(panel.getByRole('status')).toContainText('Signed in.');
  await panel.getByRole('button', { name: 'Close' }).click();

  await waitUntilConnected(page);
  await expect(page.locator('#status-text')).toHaveText('Connected to Fake Assistant on this computer.');
  await expect(page.locator('#account')).toHaveText('Fake Plan · author@example.com');
});

test('a wrong code is reported, and the sign-in can be tried again', async () => {
  // Keys go to the page only once it has started: wait for it to say where the assistant stands.
  await expect(page.locator('#status-text')).toHaveText(/is not signed in/);
  await page.keyboard.press('Alt+A');
  await page.keyboard.press('i');
  const panel = page.getByRole('dialog', { name: 'Sign In' });
  await panel.getByRole('button', { name: 'Start Sign-In' }).click();
  await expect(panel.getByLabel('Sign-in page:')).not.toHaveValue('');
  await panel.getByLabel('Code from the page:').fill('wrong-code');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('status')).toContainText('did not complete');
  await expect(panel.getByRole('button', { name: 'Start Sign-In' })).toBeEnabled();
});
