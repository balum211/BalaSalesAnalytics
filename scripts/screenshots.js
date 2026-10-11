// Captures portal screenshots for documentation: node scripts/screenshots.js [baseUrl]
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const base = process.argv[2] || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shots = [
    ['midnight', 'overview'], ['midnight', 'logistics'], ['daylight', 'products'], ['corporate', 'orders'],
    ['aurora', 'insights'], ['sandstone', 'overview'], ['corporate', 'overview'], ['daylight', 'powerbi'],
  ];
  for (const [theme, view] of shots) {
    await page.goto(`${base}/#${view}`);
    await page.evaluate((t) => { localStorage.setItem('cs-theme', t); }, theme);
    await page.reload();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `docs/screenshots/${view}-${theme}.png`, fullPage: true });
  }
  // empty state
  await page.goto(`${base}/#overview`);
  await page.waitForTimeout(500);
  await page.fill('#fFrom', '2025-12-31'); await page.dispatchEvent('#fFrom', 'change');
  await page.selectOption('#f_region', 'Latin America');
  await page.selectOption('#f_carrier', 'SkyBridge Cargo');
  await page.selectOption('#f_ship_mode', 'Ocean');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/empty-state.png' });
  // mobile
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(`${base}/#overview`); await m.waitForTimeout(900);
  await m.screenshot({ path: 'docs/screenshots/mobile-overview.png', fullPage: true });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('mobile horizontal overflow:', overflow);
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
