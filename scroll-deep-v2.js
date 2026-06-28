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
  
  // Exclude <main> from the check — it's the container, not the scroll target
  // Check if the PAGE-LEVEL div (child of main) properly scrolls
  const testPages = [
    '/pos', '/pos/menu', '/pos/settings', '/pos/history', '/pos/purchase-orders',
    '/pos/inventory/adjustment', '/pos/customers', '/pos/reservations', '/pos/discounts',
    '/pos/promos', '/pos/shift', '/pos/waste', '/pos/transfers', '/pos/suppliers',
    '/pos/prep-sheets', '/pos/settings/hardware', '/pos/accounting-export',
    '/pos/accounting/pnl', '/pos/purchase-orders/report', '/pos/purchase-orders/new',
    '/pos/menu/combos', '/pos/menu/engineering', '/pos/shifts/history', '/pos/orders/receipt',
  ];
  
  const viewports = [
    { name: 'Mobile (375x667)', width: 375, height: 667 },
    { name: 'Laptop (1280x800)', width: 1280, height: 800 },
  ];
  
  let allPassed = true;
  const issues = [];
  
  for (const vp of viewports) {
    console.log(`\n=== ${vp.name} ===`);
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    
    for (const path of testPages) {
      try {
        await page.goto(`https://pos-uat.akhairi.com${path}`, { waitUntil: 'networkidle', timeout: 15000 });
        
        const result = await page.evaluate(() => {
          const main = document.querySelector('main');
          if (!main) return { noMain: true };
          
          // Get the first child of main (the page-level div)
          const pageDiv = main.firstElementChild;
          if (!pageDiv) return { noPageDiv: true };
          
          const mainCs = getComputedStyle(main);
          const pageCs = getComputedStyle(pageDiv);
          
          // Check: main should clip, pageDiv should scroll
          const mainClips = mainCs.overflowY === 'hidden' || mainCs.overflow === 'hidden';
          const pageScrolls = pageCs.overflowY === 'auto' || pageCs.overflowY === 'scroll';
          
          // Check: does the pageDiv have scrollable content?
          const pageContentOverflows = pageDiv.scrollHeight > pageDiv.clientHeight + 5;
          
          // Check: does main overflow (should NOT if pageDiv is scrolling)?
          const mainOverflows = main.scrollHeight > main.clientHeight + 5;
          
          // Check body
          const bodyOverflows = document.body.scrollHeight > document.documentElement.clientHeight + 5;
          const hasHScroll = document.body.scrollWidth > document.documentElement.clientWidth + 5;
          
          return {
            mainClips,
            pageScrolls,
            pageContentOverflows,
            pageScrollH: pageDiv.scrollHeight,
            pageClientH: pageDiv.clientHeight,
            mainOverflows,
            mainScrollH: main.scrollHeight,
            mainClientH: main.clientHeight,
            bodyOverflows,
            hasHScroll,
            pageClass: pageDiv.className.substring(0, 100),
          };
        });
        
        let pageIssues = [];
        if (result.noMain) pageIssues.push('NO-MAIN');
        else if (result.noPageDiv) pageIssues.push('NO-PAGE-DIV');
        else {
          // Critical: if pageDiv should scroll but doesn't
          if (result.pageContentOverflows && !result.pageScrolls) {
            pageIssues.push('PAGE-OVERFLOWS-NO-SCROLL');
          }
          // Acceptable: main clips (that's by design) but pageDiv scrolls
          // Problem: pageDiv doesn't scroll AND main overflows AND body overflows
          if (!result.pageScrolls && result.mainOverflows && result.bodyOverflows) {
            pageIssues.push('FULL-PAGE-SCROLL');
          }
          if (result.hasHScroll) pageIssues.push('H-OVERFLOW');
        }
        
        if (pageIssues.length > 0) {
          console.log(`  ${path}: ✗ ${pageIssues.join(', ')}`);
          if (result.pageDiv) {
            console.log(`    pageDiv: class=${result.pageClass} scrollH=${result.pageScrollH} clientH=${result.pageClientH} scrolls=${result.pageScrolls}`);
          }
          issues.push(`${vp.name} ${path}: ${pageIssues.join(', ')}`);
          allPassed = false;
        } else {
          // Print scroll status for debugging
          if (result.pageContentOverflows && result.pageScrolls) {
            // Good - content overflows but page scrolls
          }
        }
      } catch (e) {
        console.log(`  ${path}: ✗ ERROR: ${e.message.substring(0, 60)}`);
        issues.push(`${vp.name} ${path}: ERROR`);
        allPassed = false;
      }
    }
    await page.close();
  }
  
  await browser.close();
  
  if (allPassed) {
    console.log(`\n✓ ALL ${testPages.length * viewports.length} PASSED — no real scroll issues`);
  } else {
    console.log(`\n✗ FAILURES (${issues.length}):`);
    issues.forEach(i => console.log(`  - ${i}`));
  }
  
  process.exit(allPassed ? 0 : 1);
})();
