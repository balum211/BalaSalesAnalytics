// Captures screenshots of the chat assistant for documentation: node scripts/chat-screenshots.js [baseUrl]
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const base = process.argv[2] || 'http://localhost:3000';
const out = (n) => require('path').join(__dirname, '..', 'docs', 'screenshots', n);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const ask = async (pg, q) => { await pg.fill('#chatInput', q); await pg.press('#chatInput', 'Enter'); await pg.waitForTimeout(900); };
  await p.goto(`${base}/#overview`); await p.waitForTimeout(800);
  await p.click('#chatFab'); await p.waitForTimeout(400);
  await ask(p, 'Which carrier has the worst on-time delivery?');
  await ask(p, 'Monthly revenue trend in 2025');
  await p.screenshot({ path: out('chat-horizon.png') });
  await p.click('.chip-s >> nth=0'); await p.waitForTimeout(900);
  await p.click('.apply >> nth=-1'); await p.waitForTimeout(700);
  await p.evaluate(() => localStorage.setItem('cs-theme-v2', 'daylight')); await p.reload(); await p.waitForTimeout(700);
  await p.click('#askTop'); await p.waitForTimeout(300);
  await ask(p, 'Compare Europe vs Asia Pacific profit');
  await ask(p, 'Which region grew fastest?');
  await p.screenshot({ path: out('chat-daylight.png') });
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(`${base}/#ask`); await m.waitForTimeout(900);
  await ask(m, 'Top 5 products by revenue');
  await m.screenshot({ path: out('chat-mobile.png') });
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
