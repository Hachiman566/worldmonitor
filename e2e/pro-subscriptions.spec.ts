import { test, expect } from '@playwright/test';

const config = { available: true, portalUrl: 'https://billing.stripe.com/p/login/test_fixture' };
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
  await page.route('**/api/billing/config', route => route.fulfill({ json: config }));
});
test('monthly/yearly selection, email validation and failed checkout retry', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/billing/checkout', async route => { requests.push(route.request().postDataJSON()); await route.fulfill({ status: 503, json: { error: 'unavailable' } }); });
  await page.goto('/pro/#subscribe');
  await expect(page.getByRole('heading', { name: 'Choose your subscription' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Monthly/ })).toBeChecked();
  await page.getByRole('radio', { name: /Yearly/ }).check();
  await expect(page.getByText('100 USD', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  expect(requests).toHaveLength(0);
  await page.getByLabel('Billing email').fill(['test', 'example.invalid'].join('@'));
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('alert')).toContainText('try again');
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0].plan).toBe('yearly');
  expect(requests[0].attemptId).toBe(requests[1].attemptId);
  await expect(page.getByRole('link', { name: 'Manage subscription' })).toHaveAttribute('href', config.portalUrl);
});
test('unavailable configuration disables purchase and absent portal', async ({ page }) => {
  await page.route('**/api/billing/config', route => route.fulfill({ json: { available: false, portalUrl: null } }));
  await page.goto('/pro/#subscribe');
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  await expect(page.getByText('Subscription checkout is not available yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage subscription' })).toHaveCount(0);
});
for (const status of ['confirmed', 'processing', 'canceled', 'failed']) test(`${status} return clears parameters and mobile stays within viewport`, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/billing/status?*', route => route.fulfill({ json: { status } }));
  await page.goto(`/pro/?checkout=${status === 'canceled' ? 'canceled' : 'success'}&session_id=cs_test_fixture#subscribe`);
  const copy = { confirmed: 'Payment confirmed', processing: 'Payment is processing', canceled: 'Checkout canceled', failed: 'Payment failed' };
  await expect(page.getByRole('status')).toContainText(copy[status]);
  expect(page.url()).not.toContain('session_id');
  if (status === 'failed') await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  const section = page.locator('#subscribe');
  expect(await section.evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true);
  await section.screenshot({ path: `/tmp/worldmonitor-billing/${status}-mobile.png`, style: 'nav { visibility: hidden; }' });
});
test('keyboard plan selection and desktop layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/pro/#subscribe');
  await page.getByRole('radio', { name: /Monthly/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Yearly/ })).toBeChecked();
  await page.locator('#subscribe').screenshot({ path: '/tmp/worldmonitor-billing/desktop.png', style: 'nav { visibility: hidden; }' });
});
test('double click sends one request and verifies checkout URL', async ({ page }) => {
  let count = 0;
  await page.route('**/api/billing/checkout', async route => { count++; await new Promise(resolve => setTimeout(resolve, 150)); await route.fulfill({ json: { url: 'https://untrusted.invalid' } }); });
  await page.goto('/pro/#subscribe');
  await page.getByLabel('Billing email').fill(['test', 'example.invalid'].join('@'));
  await page.getByRole('button', { name: 'Continue to payment' }).dblclick();
  await expect(page.getByRole('alert')).toBeVisible(); expect(count).toBe(1);
  expect(page.url()).toContain('/pro/');
});
