const { test, expect } = require ( '@playwright/test');


test('all services running', async ({ request }) => {
  const web = await request.get(`http://localhost:3000/healthz`)
  expect(web.ok()).toBeTruthy();

  const ordering = await request.get(`http://localhost:9090/healthz`)
  expect(ordering.ok()).toBeTruthy();

  
  const factory = await request.get(`http://localhost:9091/healthz`)
  expect(factory.ok()).toBeTruthy();
});


test('end-to-end order creation', async ({ page }) => {

  test.skip(false, 'already used up the stock');


  await page.goto('http://localhost:3000');

  // Check Tenent has been initialised OK
  const tenentName = await page.textContent('[data-testid=TenentName]')
  await expect(tenentName).toBe('Demo Bike Shop');

  // Locator: https://playwright.dev/docs/api/class-locator
  // Locators are the central piece of Playwright's auto-waiting and retry-ability.

  // Select the First product Category // Mountain Bikes
  // https://playwright.dev/docs/selectors#n-th-element-selector
  const nth_idx_category = 0 // starts 0
  const onecategory = await page.locator(`.m-panes-product-placement-item > div > div > .c-call-to-action >> nth=${nth_idx_category}`)
  await onecategory.waitFor();
  await expect(onecategory, `Cannot find idx=${nth_idx_category} Product Category, calagloe not loaded!`).toBeVisible();
  await onecategory.click();


  // Select the nth=1 Product
  const nth_idx_product_in_category = 0 // starts 0
  const twoproduct = await page.locator(`.m-panes-product-placement-item > div > div > .c-call-to-action  >> nth=${nth_idx_product_in_category}`)
  await twoproduct.waitFor();

  await expect(twoproduct, `Cannot find idx=${nth_idx_product_in_category} Product, calagloe not loaded correctly?`).toBeVisible();
  await twoproduct.click();

  // Add to Cart!  button will be disabled if no inventory & the test will fail!
  // Text selector  - https://playwright.dev/docs/selectors#quick-guide
  let a2c = page.locator('text=Add to Cart')
  await a2c.waitFor();

  let remainingWait = 30
  test.setTimeout((5+remainingWait)*1000);
  const checkEvery = 5
  console.log (`${ await a2c.isEnabled()} - ${remainingWait}`)
  while (!await a2c.isEnabled() && remainingWait > 0) {
    console.log (`No stock avaiable, wanting for stock to be creatd by the factory process (${remainingWait}seconds)...`)
    await new Promise(resolve => setTimeout(resolve, checkEvery*1000)); remainingWait=remainingWait-checkEvery
    await page.reload()

    a2c = page.locator('text=Add to Cart')
    await a2c.waitFor();
  }

  await expect(a2c, `'Add to Cart' disabled!, no inventory, check inventory orders`).toBeEnabled();
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
  //  if B2C_TENANT Identity is enabled, this will redirect to B2C policy!
  const po = await page.locator('text=Place Order');
  await po.waitFor();
  await po.click()

  // My Orders
  // http://localhost:3000/myorders
  const mo = await page.locator('text=My Orders');
  await mo.waitFor();
  await mo.click()

  // WORKAROUND - need this otherwise rows.count is not consitant, due to table loading/rendering
  const fst_rows = await page.locator('table tbody tr >> nth=0');
  await fst_rows.waitFor();

  const rows = await page.locator('table tbody tr');
  const count = await rows.count()
  console.log (`orders count = ${count}`)
  expect (count >0 ).toBeTruthy()

  console.log(await rows.nth(0).textContent())
  
})

test('order status', async ({ page }) => {


  await page.goto('http://localhost:3000/myorders');

  // WORKAROUND - need this otherwise rows.count is not consitant, due to table loading/rendering
  const fst_rows = await page.locator('table tbody tr >> nth=0');
  await fst_rows.waitFor();

  const rows = await page.locator('table tbody tr');
  // 0 is header row!
  const count = await rows.count()
  console.log (`orders count = ${count}`)
  expect (count >0 ).toBeTruthy()

  const lastorder = await rows.last()

  const ordernumber = await  lastorder.locator('td >> nth=0').textContent(),
        orderstate = await  lastorder.locator('td >> nth=2').textContent()

  console.log (`${ordernumber}:  ${orderstate}`)
})
