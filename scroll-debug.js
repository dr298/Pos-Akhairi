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
  
  // Test pages with CLIPPED-CONTENT at 1280x800
  const problemPages = ['/pos/z-report', '/pos/menu/engineering'];
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  
  for (const path of problemPages) {
    await page.goto(`https://pos-uat.akhairi.com${path}`, { waitUntil: 'networkidle', timeout: 15000 });
    
    const info = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('[class*="flex-1"]').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
          if (el.scrollHeight > el.clientHeight + 5) {
            results.push({
              tag: el.tagName,
              className: el.className.substring(0, 120),
              scrollH: el.scrollHeight,
              clientH: el.clientHeight,
              overflow: cs.overflow,
              overflowY: cs.overflowY,
              childCount: el.children.length,
              innerHTML: el.innerHTML.substring(0, 200),
            });
          }
        }
      });
      return results;
    });
    
    console.log(`\n${path}:`);
    info.forEach((el, i) => {
      console.log(`  [${i}] tag=${el.tag} overflow=${el.overflow} overflowY=${el.overflowY}`);
      console.log(`      scrollH=${el.scrollH} clientH=${el.clientH} (overflow by ${el.scrollH - el.clientH}px)`);
      console.log(`      class: ${el.className}`);
      console.log(`      children: ${el.childCount}, innerHTML snippet: ${el.innerHTML.substring(0, 150)}`);
    });
  }
  
  // Also test /pos on mobile to see what's clipped
  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 375, height: 667 });
  await mobilePage.goto('https://pos-uat.akhairi.com/pos', { waitUntil: 'networkidle', timeout: 15000 });
  
  const posInfo = await mobilePage.evaluate(() => {
    const results = [];
    document.querySelectorAll('[class*="flex-1"]').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
        if (el.scrollHeight > el.clientHeight + 5) {
          results.push({
            tag: el.tagName,
            className: el.className.substring(0, 120),
            scrollH: el.scrollHeight,
            clientH: el.clientHeight,
          });
        }
      }
    });
    return results;
  });
  
  console.log(`\n/pos (mobile 375x667):`);
  posInfo.forEach((el, i) => {
    console.log(`  [${i}] tag=${el.tag} scrollH=${el.scrollH} clientH=${el.clientH} overflow by ${el.scrollH - el.clientH}px`);
    console.log(`      class: ${el.className}`);
  });
  
  await browser.close();
})();
