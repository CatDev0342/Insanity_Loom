// End-to-end tests: start the real, built application and use it as the author would.
import { defineConfig } from '@playwright/test';

// How long one test may take, in milliseconds, before it is failed. Starting Electron on a busy build machine can
// take several seconds by itself.
const TEST_TIME_LIMIT_MS = 60_000;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: TEST_TIME_LIMIT_MS,
  // One application at a time: each test starts its own copy, and copies share the development Data folder.
  workers: 1,
  // On GitHub, failures are also reported as annotations on the run, where they can be read without its logs.
  reporter: process.env['GITHUB_ACTIONS'] === 'true' ? [['list'], ['github']] : [['list']],
  // A failed test keeps a trace — screenshots, the page's structure and every step — in test-results/.
  use: { trace: 'retain-on-failure' },
});
