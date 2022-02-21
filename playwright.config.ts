// playwright.config.ts
import { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  // Look for test files in the "tests" directory, relative to this configuration file
  testDir: 'tests',

  // Each test is given 10 seconds
  timeout: 10000,

  // Forbid test.only on CI
  forbidOnly: !!process.env.CI,

  // Two retries for each test
  retries: 0,

  // Limit the number of workers on CI, use default locally
  // Disable parallelism == 1
  workers: process.env.CI ? 1 : 1,

  use: {
    // Configure browser and context here
  },
};
export default config;