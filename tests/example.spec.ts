const { test, expect } = require ( '@playwright/test');

test('basic test', async ({ page }) => {

  await page.goto('http://localhost:3000');

  const tenentName = await page.locator('data-test-id=TenentName')
  await expect(tenentName).toHaveText('Demo Bike Shop');
})