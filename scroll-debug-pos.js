const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  
  // Login
  const lp = await context.newPage();
  await lp.goto('https://pos-uat.akhairi.com/login');
  await lp.fill('input[type="email"], input[name="email"]', 'owner@bkj.id');
  await lp.fill('input[type="password"], input[name="password"]', 'password123');
  await lp.click('button:has-text("Masuk")');
  await lp.waitForURL('**/pos', { timeout: 10000 });
  await lp.close();
  
  const page = await context.newPage();
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('https://pos-uat.akhairi.com/pos', { waitUntil: 'networkidle', timeout: 15000 });
  
  const info = await page.evaluate(() => {
    const main = document.querySelector('main');
    const pageDiv = main?.firstElementChild;
    if (!pageDiv) return { error: 'no pageDiv' };
    
    const mainCs = getComputedStyle(main);
    const pageCs = getComputedStyle(pageDiv);
    
    // Get all children of pageDiv
    const children = [];
    for (const child of pageDiv.children) {
      const cs = getComputedStyle(child);
      children.push({
        tag: child.tagName,
        className: child.className.substring(0, 80),
        display: cs.display,
        flex: cs.flex,
        height: cs.height,
        overflow: cs.overflow,
        overflowY: cs.overflowY,
        scrollH: child.scrollHeight,
        clientH: child.clientHeight,
        offsetH: child.offsetHeight,
      });
    }
    
    return {
      mainOverflowY: mainCs.overflowY,
      mainScrollH: main.scrollHeight,
      mainClientH: main.clientHeight,
      pageClass: pageDiv.className.substring(0, 100),
      pageDisplay: pageCs.display,
      pageOverflowY: pageCs.overflowY,
      pageScrollH: pageDiv.scrollHeight,
      pageClientH: pageDiv.clientHeight,
      pageOffsetH: pageDiv.offsetHeight,
      children,
    };
  });
  
  console.log('POS page (375x667):');
  console.log('main:', JSON.stringify({ overflowY: info.mainOverflowY, scrollH: info.mainScrollH, clientH: info.mainClientH }, null, 2));
  console.log('pageDiv:', JSON.stringify({ class: info.pageClass, display: info.pageDisplay, overflowY: info.pageOverflowY, scrollH: info.pageScrollH, clientH: info.pageClientH, offsetH: info.pageOffsetH }, null, 2));
  console.log('children:');
  info.children?.forEach((c, i) => {
    console.log(`  [${i}] ${c.tag} class="${c.className}" overflow=${c.overflow} overflowY=${c.overflowY} scrollH=${c.scrollH} clientH=${c.clientH} offsetH=${c.offsetH}`);
  });
  
  await browser.close();
})();
