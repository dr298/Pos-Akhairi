const { chromium } = require('playwright');

(async () => {
  const pages = [
    '/pos', '/pos/menu', '/pos/settings', '/pos/history', '/pos/purchase-orders',
    '/pos/inventory/adjustment', '/pos/customers', '/pos/reservations', '/pos/discounts',
    '/pos/promos', '/pos/shift', '/pos/waste', '/pos/transfers', '/pos/suppliers',
    '/pos/prep-sheets', '/pos/settings/hardware', '/pos/accounting-export',
    '/pos/accounting/pnl', '/pos/purchase-orders/report', '/pos/purchase-orders/new',
    '/pos/menu/combos', '/pos/menu/engineering', '/pos/shifts/history', '/pos/orders/receipt',
  ];
  
  const viewports = [
    { name: 'Mobile 375x667', width: 375, height: 667 },
    { name: 'Tablet 768x1024', width: 768, height: 1024 },
    { name: 'Laptop 1280x800', width: 1280, height: 800 },
  ];
  
  let allPassed = true;
  const issues = [];
  
  for (const vp of viewports) {
    console.log(`\n=== ${vp.name} ===`);
    // Fresh browser per viewport to avoid context crash
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    
    // Login
    const lp = await context.newPage();
    await lp.goto('https://pos-uat.akhairi.com/login');
    await lp.fill('input[type="email"], input[name="email"]', 'owner@bkj.id');
    await lp.fill('input[type="password"], input[name="password"]', 'password123');
    await lp.click('button:has-text("Masuk")');
    await lp.waitForURL('**/pos', { timeout: 15000 });
    await lp.close();
    
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    
    for (const path of pages) {
      try {
        await page.goto(`https://pos-uat.akhairi.com${path}`, { waitUntil: 'networkidle', timeout: 15000 });
        
        const result = await page.evaluate(() => {
          const body = document.body;
          const html = document.documentElement;
          const main = document.querySelector('main');
          const pageDiv = main?.firstElementChild;
          
          const bodyOverflows = body.scrollHeight > html.clientHeight + 5;
          const hasHScroll = body.scrollWidth > html.clientWidth + 5;
          
          if (!pageDiv) return { bodyOverflows, hasHScroll, noPageDiv: true };
          
          const pageCs = getComputedStyle(pageDiv);
          const pageScrolls = pageCs.overflowY === 'auto' || pageCs.overflowY === 'scroll';
          const pageContentOverflows = pageDiv.scrollHeight > pageDiv.clientHeight + 5;
          
          // Real issue: pageDiv has content that overflows but no scroll
          const fullPageScroll = bodyOverflows && !pageScrolls;
          
          return {
            bodyOverflows,
            hasHScroll,
            fullPageScroll,
            pageScrolls,
            pageContentOverflows,
          };
        });
        
        let pageIssues = [];
        if (result.bodyOverflows) pageIssues.push('BODY-V-SCROLL');
        if (result.hasHScroll) pageIssues.push('H-OVERFLOW');
        if (result.fullPageScroll) pageIssues.push('FULL-PAGE-SCROLL');
        if (result.noPageDiv) pageIssues.push('NO-PAGE-DIV');
        
        if (pageIssues.length > 0) {
          console.log(`  ${path}: ✗ ${pageIssues.join(', ')}`);
          issues.push(`${vp.name} ${path}: ${pageIssues.join(', ')}`);
          allPassed = false;
        }
      } catch (e) {
        console.log(`  ${path}: ✗ NAV-ERROR`);
        issues.push(`${vp.name} ${path}: NAV-ERROR`);
        allPassed = false;
      }
    }
    
    await browser.close();
  }
  
  console.log(allPassed 
    ? `\n✓ ALL ${pages.length * viewports.length} PASSED`
    : `\n✗ ${issues.length} FAILURES:\n${issues.map(i => '  - ' + i).join('\n')}`);
  
  process.exit(allPassed ? 0 : 1);
})();
