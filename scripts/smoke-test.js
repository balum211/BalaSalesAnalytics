// Smoke test: starts the server on a random port and checks every API endpoint.  npm test
const assert = require('assert');
const server = require('../server.js');
server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const get = async (p, opt) => { const r = await fetch(base + p, opt); return { status: r.status, body: await r.json().catch(() => null) }; };
  try {
    let r = await get('/api/health'); assert.equal(r.body.status, 'ok'); assert.equal(r.body.orders, 6000);
    r = await get('/api/kpis'); assert.ok(r.body.revenue > 0 && r.body.on_time_pct > 0 && r.body.on_time_pct <= 100);
    const all = r.body.revenue;
    r = await get('/api/kpis?region=Europe'); assert.ok(r.body.revenue < all);
    r = await get('/api/breakdown/region'); assert.equal(r.body.length, 5);
    const sum = r.body.reduce((s, g) => s + g.revenue, 0); assert.ok(Math.abs(sum - all) < 1, 'regions sum to total');
    r = await get('/api/breakdown/month'); assert.equal(r.body.length, 24);
    r = await get('/api/breakdown/nope'); assert.equal(r.status, 400);
    r = await get('/api/orders?size=10&page=2&carrier=Atlas%20Freight'); assert.equal(r.body.data.length, 10); assert.ok(r.body.data.every((o) => o.carrier === 'Atlas Freight'));
    r = await get('/api/kpis?from=2030-01-01'); assert.equal(r.body.orders, 0);
    r = await get('/api/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.ok(r.body.insights.length >= 5);
    const page = await fetch(base + '/'); assert.equal(page.status, 200);
    const trav = await fetch(base + '/../server.js'); assert.notEqual(trav.status, 200);
    console.log('✔ all smoke tests passed');
    process.exitCode = 0;
  } catch (e) { console.error('✘', e.message); process.exitCode = 1; }
  server.close();
});
