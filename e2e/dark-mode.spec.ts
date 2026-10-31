import { test, expect } from '@playwright/test';

test.describe('dark mode toggle', () => {
  test('persists the toggled theme across a page reload', async ({ page, context }) => {
    // Start from a known 'light' state rather than relying on the browser's
    // system color-scheme preference, which the first-visit bootstrap script
    // would otherwise use and make this test non-deterministic.
    await context.addCookies([
      { name: 'theme', value: 'light', url: 'http://localhost:8787' },
    ]);
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).not.toHaveClass(/dark/);

    await page.click('#themeToggle');
    await expect(html).toHaveClass(/dark/);

    // The click handler writes a 'theme' cookie the server reads on the next
    // request, so a reload should render pre-darkened — no flash, no re-click.
    await page.reload();
    await expect(html).toHaveClass(/dark/);
  });
});
