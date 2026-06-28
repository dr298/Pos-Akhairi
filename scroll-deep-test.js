const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  const viewports = [
    { name: 'Mobile (375x667)', width: 375, height: 667 },
    { name: 'Tablet (768x1024)', width: 768, height: 1024 },
    { name: 'Laptop (1280x800)', width: 1280, height: 800 },
  ];
  
  const pages = [
    '/pos', '/pos/menu', '/pos/settings', '/pos/history', '/pos/purchase-orders',
    '/pos/inventory/adjustment', '/pos/customers', '/pos/reservations', '/pos/discounts',
    '/pos/promos', '/pos/shift', '/pos/waste', '/pos/z-report', '/pos/transfers',
    '/pos/suppliers', '/pos/prep-sheets', '/pos/settings/hardware', '/pos/accounting-export',
    '/pos/accounting/pnl', '/pos/purchase-orders/report', '/pos/purchase-orders/new',
    '/pos/menu/combos', '/pos/menu/engineering', '/pos/shifts/history', '/pos/orders/receipt',
  ];
  
  const context = await browser.newContext();
  // Login
  const lp = await context.newPage();
  await lp.goto('https://pos-uat.akhairi.com/login');
  await lp.fill('input[type="email"], input[name="email"]', 'owner@bkj.id');
  await lp.fill('input[type="password"], input[name="password"]', 'password123');
  await lp.click('button:has-text("Masuk")');
  await lp.waitForURL('**/pos', { timeout: 10000 });
  await lp.close();
  
  let allPassed = true;
  const issues = [];
  
  for (const vp of viewports) {
    console.log(`\n=== ${vp.name} ===`);
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    
    for (const path of pages) {
      try {
        await page.goto(`https://pos-uat.akhairi.com${path}`, { waitUntil: 'networkidle', timeout: 15000 });
        
        const result = await page.evaluate(() => {
          const body = document.body;
          const html = document.documentElement;
          const main = document.querySelector('main');
          
          // 1. Body scroll check
          const bodyOverflows = body.scrollHeight > html.clientHeight + 5;
          const hasHScroll = body.scrollWidth > html.clientWidth + 5;
          
          // 2. Check main overflow behavior
          const mainCs = main ? getComputedStyle(main) : null;
          const mainOverflows = main ? (
            main.scrollHeight > main.clientHeight + 5 && 
            mainCs?.overflow !== 'hidden' && 
            mainCs?.overflowY !== 'hidden'
          ) : false;
          
          // 3. Check for content clipping - find all flex-1 elements and check if any have visible content cut off
          const flex1Els = document.querySelectorAll('[class*="flex-1"]');
          let clippedContent = false;
          flex1Els.forEach(el => {
            const cs = getComputedStyle(el);
            // If element has overflow:hidden and its scrollHeight > clientHeight, content is clipped
            if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
              if (el.scrollHeight > el.clientHeight + 5) {
                clippedContent = true;
              }
            }
          });
          
          // 4. Check for any element with overflow-y:auto or scroll that actually has scrollable content
          const scrollContainers = [];
          document.querySelectorAll('*').forEach(el => {
            const cs = getComputedStyle(el);
            if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
              if (el.scrollHeight > el.clientHeight + 5) {
                scrollContainers.push({
                  tag: el.tagName,
                  className: el.className.substring(0, 60),
                  scrollH: el.scrollHeight,
                  clientH: el.clientHeight,
                  overflow: cs.overflowY,
                });
              }
            }
          });
          
          // 5. Sidebar check on mobile
          const sidebar = document.querySelector('aside');
          const sidebarVisible = sidebar ? getComputedStyle(sidebar).display !== 'none' : false;
          
          return {
            bodyOverflows,
            hasHScroll,
            mainOverflows,
            clippedContent,
            scrollContainers: scrollContainers.length,
            sidebarVisible,
            scrollH: body.scrollHeight,
            clientH: html.clientHeight,
          };
        });
        
        let pageIssues = [];
        if (result.bodyOverflows) pageIssues.push('BODY-V-SCROLL');
        if (result.hasHScroll) pageIssues.push('BODY-H-SCROLL');
        if (result.mainOverflows) pageIssues.push('MAIN-SCROLL');
        if (result.clippedContent) pageIssues.push('CLIPPED-CONTENT');
        if (result.sidebarVisible && vp.width < 768) pageIssues.push('SIDEBAR-VISIBLE-MOBILE');
        
        if (pageIssues.length > 0) {
          console.log(`  ${path}: ✗ ${pageIssues.join(', ')} scrollContainers=${result.scrollContainers} scrollH=${result.scrollH} clientH=${result.clientH}`);
          issues.push(`${vp.name} ${path}: ${pageIssues.join(', ')}`);
          allPassed = false;
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
    console.log(`\n✓ ALL ${pages.length * viewports.length} PASSED`);
  } else {
    console.log(`\n✗ FAILURES (${issues.length}):`);
    issues.forEach(i => console.log(`  - ${i}`));
  }
  
  process.exit(allPassed ? 0 : 1);
})();
