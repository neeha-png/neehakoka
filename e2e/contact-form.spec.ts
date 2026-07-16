import { test, expect } from '@playwright/test';

test.describe('contact form', () => {
  test('shows a live character counter while typing the message', async ({ page }) => {
    await page.goto('/contact');

    const counter = page.locator('#message-counter');
    await expect(counter).toHaveText('0 / 2000');

    await page.fill('#message', 'a'.repeat(50));
    await expect(counter).toHaveText('50 / 2000');
  });

  test('submits successfully and shows the success state', async ({ page }) => {
    // Stub the API response instead of hitting the real endpoint: the real
    // handler calls the live Resend API and writes to D1, which would send
    // a real email and pollute local data on every test run. This test is
    // about the frontend's request/response handling, not backend delivery
    // (that boundary is covered separately — see DECISIONS.md).
    let capturedPayload: unknown = null;
    await page.route('**/api/contact', async (route) => {
      capturedPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Success! Your message was sent.' }),
      });
    });

    await page.goto('/contact');
    await page.fill('#name', 'Ada Lovelace');
    await page.fill('#email', 'ada@example.com');
    await page.fill('#message', 'Hello, I would like to get in touch!');
    await page.click('#submit-btn');

    const status = page.locator('#form-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveText('Success! Your message was sent.');

    // Form resets and the counter reflects the now-empty textarea
    await expect(page.locator('#name')).toHaveValue('');
    await expect(page.locator('#message-counter')).toHaveText('0 / 2000');

    expect(capturedPayload).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      message: 'Hello, I would like to get in touch!',
    });
  });
});
