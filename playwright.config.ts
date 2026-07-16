import { defineConfig, devices } from '@playwright/test';

// E2E runs against a real `wrangler dev` process (via `npm run preview`), not
// `astro dev` — the contact form's rate limiter is D1-backed, and only the
// real Worker runtime exercises that binding instead of a proxied/mocked one.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    // `preview` runs a full `astro build` before `wrangler dev` starts, so
    // the default 60s boot timeout isn't enough.
    timeout: 120_000,
  },
});
