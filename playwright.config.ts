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
  reporter: [['list']],
});
