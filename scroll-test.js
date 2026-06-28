const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  const viewports = [
    { name: 'iPhone SE (375x667)', width: 375, height: 667 },
    { name: 'iPad (768x1024)', width: 768, height: 1024 },
    { name: 'Laptop (1280x800)', width: 1280, height: 800 },
  ];
  
  const pages = ['/pos', '/pos/menu', '/pos/settings', '/pos/history', '/pos/purchase-orders', '/pos/inventory/adjustment'];
  
  const context = await browser.newContext();
  // Login first
  const loginPage = await context.newPage();
  await loginPage.goto('https://pos-uat.akhairi.com/login');
  await loginPage.fill('input[type="email"], input[name="email"]', 'owner@bkj.id');
  await loginPage.fill('input[type="password"], input[name="password"]', 'password123');
  await loginPage.click('button:has-text("Masuk")');
  await loginPage.waitForURL('**/pos', { timeout: 10000 });
  await loginPage.close();
  
  let allPassed = true;
  
  for (const vp of viewports) {
    console.log(`\n=== ${vp.name} (${vp.width}x${vp.height}) ===`);
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    
    for (const path of pages) {
      try {
        await page.goto(`https://pos-uat.akhairi.com${path}`, { waitUntil: 'networkidle', timeout: 15000 });
        
        const result = await page.evaluate(() => {
          const body = document.body;
          const html = document.documentElement;
          return {
            bodyScrollH: body.scrollHeight,
            bodyClientH: html.clientHeight,
            bodyOverflows: body.scrollHeight > html.clientHeight + 5,
            bodyOverflowY: getComputedStyle(body).overflowY,
            htmlOverflowY: getComputedStyle(html).overflowY,
            hasHScroll: document.body.scrollWidth > document.documentElement.clientWidth + 5,
          };
        });
        
        const status = result.bodyOverflows ? '✗ BODY OVERFLOWS' : '✓ no body scroll';
        const hScroll = result.hasHScroll ? '✗ H-OVERFLOW' : '✓ no H-overflow';
        console.log(`  ${path}: ${status} | ${hScroll} | scrollH=${result.bodyScrollH} clientH=${result.bodyClientH} bodyOY=${result.bodyOverflowY} htmlOY=${result.htmlOverflowY}`);
        if (result.bodyOverflows) allPassed = false;
      } catch (e) {
        console.log(`  ${path}: ✗ ERROR: ${e.message.substring(0, 80)}`);
        allPassed = false;
      }
    }
    await page.close();
  }
  
  await browser.close();
  console.log(allPassed ? '\n✓ ALL PASSED' : '\n✗ SOME FAILED');
  process.exit(allPassed ? 0 : 1);
})();
