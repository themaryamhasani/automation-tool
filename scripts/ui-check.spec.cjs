const path = require('node:path');
const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/');
  await page.getByLabel('نام کاربری').fill(process.env.SELF_CHECK_ADMIN || 'admin@automation.local');
  await page.getByLabel('رمز عبور').fill(process.env.SELF_CHECK_ADMIN_PASSWORD || 'Admin@12345');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page.getByRole('button', { name: /^IS/ })).toBeVisible({ timeout: 20_000 });
}

test('workspace tool list includes quality scanners', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /^IS/ }).click();
  const tools = page.locator('select').filter({ hasText: 'Node danger' }).first();
  await expect(tools).toBeVisible();
  await expect(tools).toContainText('Biome');
  await expect(tools).toContainText('gitleaks');
  await expect(tools).toContainText('axe-core');
});

test('login reaches workspace without browser errors', async ({ page }) => {
  await login(page);
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await expect(page.getByRole('button', { name: /^IS/ })).toBeVisible({ timeout: 20_000 });
  expect(errors.filter(text => !/favicon|Download the React DevTools/i.test(text))).toEqual([]);
});

test('admin routes render current headings after login', async ({ page }) => {
  await login(page);
  const routes = [
    ['/runs', 'تاریخچه اجراها'],
    ['/reports', 'گزارشات مدیریتی'],
    ['/projects', 'پروژه‌ها و محیط‌ها'],
    ['/users', 'کاربران و دسترسی‌ها'],
    ['/settings', 'تنظیمات'],
    ['/audit', 'تاریخچه عملیات'],
  ];
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: path.resolve(__dirname, '..', 'runtime', 'ui-desktop.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(8);
});

test('Chrome Recorder page presents the safe install state when Store configuration is absent', async ({ page }) => {
  await login(page);
  await page.goto('/extension');
  await expect(page.getByRole('heading', { name: 'Chrome Recorder', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'لینک نصب تنظیم نشده است', exact: true })).toBeDisabled();
  await expect(page.getByText('اقدام‌های شما در یک وب‌سایت را ضبط می‌کند')).toBeVisible();
});

test('mobile navigation opens the workspace link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: 'باز کردن منو' }).click();
  await expect(page.getByRole('link', { name: 'اتوماسیون' })).toBeVisible();
  await page.screenshot({ path: path.resolve(__dirname, '..', 'runtime', 'ui-mobile.png'), fullPage: true });
});
