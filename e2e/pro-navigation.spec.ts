import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) test(`dashboard subscription link works on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  // Match Vercel's /pro rewrite while serving the real generated page locally.
  await page.route('**/pro', route => route.continue({ url: new URL('/pro/index.html', route.request().url()).href }));
  await page.goto('/');
  if (mobile) await page.locator('#hamburgerBtn').click();
  const link = page.locator(mobile ? '#mobileMenu a[href="/pro#subscribe"]' : '.header-right a[href="/pro#subscribe"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveText(/Subscribe Pro|订阅 Pro/);
  const notice = page.getByRole('button', { name: 'Got it', exact: true });
  if (await notice.isVisible()) await notice.click();
  await link.click();
  await expect(page).toHaveURL(/\/pro#subscribe$/);
  await expect(page.getByRole('heading', { name: 'Choose your subscription' })).toBeVisible();
  const preview = page.locator('iframe[src="/?alert=false"]');
  await preview.scrollIntoViewIfNeeded();
  await expect(page.frameLocator('iframe[src="/?alert=false"]').locator('.header')).toBeVisible();
  await expect(page.frameLocator('iframe[src="/?alert=false"]').locator('iframe[src="/?alert=false"]')).toHaveCount(0);
});
