const { test, expect } = require ( '@playwright/test');


test('All services running', async ({ request }) => {
  const web = await request.get(`http://localhost:3000/healthz`)
  expect(web.ok()).toBeTruthy();

  const ordering = await request.get(`http://localhost:9090/healthz`)
  expect(ordering.ok()).toBeTruthy();

  
  const factory = await request.get(`http://localhost:9091/healthz`)
  expect(factory.ok()).toBeTruthy();
});


test('basic full system test integration test 101', async ({ page }) => {

  await page.goto('http://localhost:3000');

  // Check Tenent has been initialised OK
  const tenentName = await page.textContent('[data-testid=TenentName]')
  await expect(tenentName).toBe('Demo Bike Shop');


  // Select the First product Category // Mountain Bikes
  await page.click('.m-panes-product-placement-item > div > div > .c-call-to-action')

  // Select the First Product // Vitus 2020
  await page.waitForSelector('.m-panes-product-placement-item > div > div > .c-call-to-action')
  await page.click('.m-panes-product-placement-item > div > div > .c-call-to-action')

  // Add to Cart!  button will be disabled if no inventory & the test will fail!
  // Text selector  - https://playwright.dev/docs/selectors#quick-guide
  const a2c = page.locator('text=Add to Cart')
  await a2c.waitFor();
  await a2c.click();
  
  // Goto Cart
  // Combine css and text selectors : https://playwright.dev/docs/selectors#quick-guide
  // Use text="" to do an exact case-sensitive match
  const cart = page.locator('text="Cart"')
  await cart.waitFor();
  await cart.click();

  // checkout
  const co = await page.locator('text=Checkout');
  await co.waitFor();
  await co.click()

  // Place Order
  const po = await page.locator('text=Place Order');
  await po.waitFor();
  await po.click()

  // My Orders
  // NOTE: This will FAIL if B2C_TENANT Identity is enabled!
  const mo = await page.locator('text=My Orders');
  await mo.waitFor();
  await po.click()

  const rows = page.locator('table tr');
  const count = await rows.count()
  expect (count >0 ).toBeTruthy()

  console.log(await rows.nth(0).textContent())
  

})