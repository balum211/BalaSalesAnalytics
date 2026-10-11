/**
 * ChainSight — Supply Chain Sales Analytics portal
 * Zero-dependency Node.js server (built-in `http` only): serves the web portal + a REST API.
 *
 *   node server.js        -> http://localhost:3000
 *
 * Optional env vars (or a .env file):
 *   PORT=3000
 *   ANTHROPIC_API_KEY=sk-ant-...   enables Claude-written insights on the "AI Insights" tab
 *   CLAUDE_MODEL=claude-sonnet-5-5
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const Analytics = require('./public/js/analytics.js');
const Chat = require('./public/js/chat-engine.js');

// --- tiny .env loader (no dotenv dependency) ---
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_FILE = path.join(PUBLIC, 'data', 'orders.json');

if (!fs.existsSync(DATA_FILE)) {
  console.log('Dataset not found — generating it now...');
  require('child_process').execSync('node scripts/generate-data.js', { cwd: __dirname, stdio: 'inherit' });
}
const ROWS = Analytics.hydrate(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.csv': 'text/csv' };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
}

function filtersFrom(q) {
  const f = { from: q.get('from') || undefined, to: q.get('to') || undefined, q: q.get('q') || undefined };
  for (const d of Analytics.DIMENSIONS) if (q.get(d)) f[d] = q.get(d);
  return f;
}

function pickBrief(g) {
  const r = (n) => Math.round(n * 10) / 10;
  return { key: g.key, orders: g.orders, revenue: Math.round(g.revenue), margin_pct: r(g.margin_pct), on_time_pct: r(g.on_time_pct), avg_delivery_days: r(g.avg_delivery_days), shipping_cost_pct: r(g.shipping_cost_pct) };
}

async function claudeInsights(rows) {
  const brief = {
    kpis: Analytics.kpis(rows),
    byRegion: Analytics.groupBy(rows, 'region').map(pickBrief),
    byCategory: Analytics.groupBy(rows, 'product_category').map(pickBrief),
    byCarrier: Analytics.groupBy(rows, 'carrier', 'on_time_pct').map(pickBrief),
    byShipMode: Analytics.groupBy(rows, 'ship_mode').map(pickBrief),
    byWarehouse: Analytics.groupBy(rows, 'warehouse').map(pickBrief),
    monthly: Analytics.monthly(rows).map(pickBrief),
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: 'You are a senior supply chain analyst. Using ONLY the JSON metrics below, write 6 concise, specific insights for a VP of Operations ' +
          '(mix of opportunities, risks and cost levers, each with a recommended action). Return strict JSON only: ' +
          '[{"type":"growth|risk|cost|headline","title":"...","text":"..."}]. Cite numbers.\n\n' + JSON.stringify(brief),
      }],
    }),
  });
  if (!r.ok) throw new Error('Anthropic API ' + r.status);
  const j = await r.json();
  const text = (j.content || []).map((c) => c.text || '').join('');
  return JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
}


// ---------------------------------------------------------------- Chatbot (Claude + tool use)
const QUERY_TOOL = {
  name: 'query_sales',
  description: 'Run an aggregate query over the supply chain sales orders. Returns totals for the requested metrics and, ' +
    'when group_by is set, one row per group (sorted by sort_by). Use it for EVERY number you state. ' +
    'Filters accept a single value or a list of values. Dates are ISO strings (YYYY-MM-DD) on order_date.',
  input_schema: {
    type: 'object',
    properties: {
      metrics: { type: 'array', items: { type: 'string', enum: Object.keys(Chat.METRICS) }, description: 'Metrics to compute' },
      group_by: { type: 'string', enum: [...Object.keys(Chat.DIMS), 'none'], description: 'Dimension to break down by' },
      filters: {
        type: 'object',
        properties: Object.fromEntries([
          ['from', { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' }],
          ['to', { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' }],
          ...Chat.FILTER_DIMS.map((d) => [d, { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }]),
        ]),
      },
      sort_by: { type: 'string', enum: Object.keys(Chat.METRICS) },
      order: { type: 'string', enum: ['desc', 'asc'] },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['metrics'],
  },
};

function chatSystemPrompt() {
  return [
    'You are ChainSight Analyst, a data assistant embedded in a supply chain sales analytics dashboard.',
    'Answer questions about the dataset below. Call the query_sales tool for every figure; never guess or invent numbers.',
    'Make as many tool calls as needed (e.g. one per year to compute growth). Then answer in 2-5 short sentences of plain business English,',
    'leading with the direct answer and its number. Use a small markdown table only when comparing 3+ items. Bold the key figure.',
    'Money in USD ($1.2M style), percentages to 1 decimal, delivery time in days.',
    'Definitions: revenue excludes returned and cancelled orders; gross_profit = revenue - cogs - shipping_cost; on_time_pct is over delivered orders;',
    'late_orders = delivered after the promised date. The data is synthetic demo data for a fictional distributor.',
    'If a question is outside this dataset, say so briefly and suggest a question you can answer.',
    '', 'DATASET', Chat.schema(ROWS),
  ].join('\n');
}

async function claudeChat(question, history) {
  const messages = [];
  for (const h of (history || []).slice(-8)) {
    if ((h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim()) messages.push({ role: h.role, content: h.content.slice(0, 4000) });
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages.push({ role: 'user', content: question });
  const queries = [];
  for (let step = 0; step < 8; step++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: 1200, system: chatSystemPrompt(), tools: [QUERY_TOOL], messages }),
    });
    if (!r.ok) throw new Error('Anthropic API ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    messages.push({ role: 'assistant', content: j.content });
    const calls = (j.content || []).filter((c) => c.type === 'tool_use');
    if (j.stop_reason !== 'tool_use' || !calls.length) {
      return { source: 'claude', text: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim(), queries };
    }
    const results = calls.map((c) => {
      const out = Chat.runQuery(ROWS, c.input || {});
      queries.push(c.input);
      return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 20000) };
    });
    messages.push({ role: 'user', content: results });
  }
  throw new Error('Too many tool steps');
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (_) { resolve({}); } });
  });
}

async function api(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/api/health') return sendJson(res, 200, { status: 'ok', orders: ROWS.length, ai: !!process.env.ANTHROPIC_API_KEY });

  if (p === '/api/meta') {
    const meta = { minDate: ROWS[0].order_date, maxDate: ROWS[ROWS.length - 1].order_date };
    for (const d of Analytics.DIMENSIONS) meta[d] = Analytics.distinct(ROWS, d);
    return sendJson(res, 200, meta);
  }

  if (p === '/api/kpis') return sendJson(res, 200, Analytics.kpis(Analytics.applyFilters(ROWS, filtersFrom(q))));

  const bd = p.match(/^\/api\/breakdown\/([a-z_]+)$/);
  if (bd) {
    const dim = bd[1];
    if (![...Analytics.DIMENSIONS, 'month', 'product_name', 'customer_name', 'country'].includes(dim)) return sendJson(res, 400, { error: `Unknown dimension '${dim}'` });
    const rows = Analytics.applyFilters(ROWS, filtersFrom(q));
    return sendJson(res, 200, dim === 'month' ? Analytics.monthly(rows) : Analytics.groupBy(rows, dim));
  }

  if (p === '/api/orders') {
    const rows = Analytics.applyFilters(ROWS, filtersFrom(q));
    const page = Math.max(1, parseInt(q.get('page') || '1', 10));
    const size = Math.min(500, Math.max(1, parseInt(q.get('size') || '50', 10)));
    return sendJson(res, 200, { total: rows.length, page, size, data: rows.slice((page - 1) * size, page * size) });
  }

  if (p === '/api/insights' && req.method === 'POST') {
    const rows = Analytics.applyFilters(ROWS, await readBody(req));
    const rules = Analytics.insights(rows);
    if (!process.env.ANTHROPIC_API_KEY || !rows.length) return sendJson(res, 200, { source: 'rules', insights: rules });
    try {
      return sendJson(res, 200, { source: 'claude', insights: await claudeInsights(rows) });
    } catch (e) {
      console.warn('Claude call failed, using rule-based insights:', e.message);
      return sendJson(res, 200, { source: 'rules', insights: rules });
    }
  }


  if (p === '/api/chat' && req.method === 'POST') {
    const body = await readBody(req);
    const question = String(body.question || '').slice(0, 1000);
    if (!question.trim()) return sendJson(res, 400, { error: 'Ask a question' });
    const local = () => ({ source: 'built-in', ...Chat.answer(ROWS, question) });
    if (!process.env.ANTHROPIC_API_KEY) return sendJson(res, 200, local());
    try {
      const ai = await claudeChat(question, body.history);
      const helper = Chat.answer(ROWS, question); // chart/table for the same question when the parser understood it
      return sendJson(res, 200, { ...ai, applyFilters: helper.applyFilters, suggestions: helper.suggestions });
    } catch (e) {
      console.warn('Claude chat failed, using built-in analyst:', e.message);
      return sendJson(res, 200, { ...local(), note: 'Claude was unavailable, so the built-in analyst answered.' });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => sendJson(res, 500, { error: e.message }));
  } else serveStatic(req, res, url);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Loaded ${ROWS.length.toLocaleString()} orders`);
    console.log(`ChainSight running at http://localhost:${PORT}  (Claude insights: ${process.env.ANTHROPIC_API_KEY ? 'ON' : 'off'})`);
  });
}
module.exports = server;
