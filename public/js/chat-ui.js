/* ChainSight — "Ask the data" chat assistant (front-end)
 *
 * Answer engine, in order of preference:
 *   1. Claude via the Node server (/api/chat) when the server has ANTHROPIC_API_KEY — Claude calls the query_sales tool.
 *   2. Built-in analyst (js/chat-engine.js) — parses the question and queries the data in the browser.
 *      This is what runs on GitHub Pages / static hosting.
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const panel = $('#chatPanel'), log = $('#chatLog'), input = $('#chatInput'), form = $('#chatForm');
  const history = []; // {role, content} for Claude follow-ups
  let charts = [];
  let busy = false;
  let vocab = null;

  // ---------- open / close ----------
  function open() {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('open'));
    $('#chatFab').setAttribute('aria-expanded', 'true');
    document.body.classList.add('chat-open');
    if (!log.children.length) greet();
    setTimeout(() => input.focus(), 50);
  }
  function close() {
    panel.classList.remove('open');
    $('#chatFab').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('chat-open');
    setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 220);
  }
  const toggle = () => (panel.classList.contains('open') ? close() : open());

  // ---------- rendering ----------
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Minimal, safe markdown: escapes first, then **bold**, `code`, bullet/numbered lists, pipe tables, paragraphs. */
  function md(text) {
    const lines = escapeHtml(text || '').split(/\r?\n/);
    const out = [];
    let i = 0;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
        const head = cells(l);
        i += 2;
        const body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
        out.push(tableHtml(head, body, true));
        continue;
      }
      if (/^\s*[-*•]\s+/.test(l)) {
        const items = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push('<li>' + inline(lines[i++].replace(/^\s*[-*•]\s+/, '')) + '</li>');
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(l)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push('<li>' + inline(lines[i++].replace(/^\s*\d+[.)]\s+/, '')) + '</li>');
        out.push('<ol>' + items.join('') + '</ol>');
        continue;
      }
      if (/^#{1,4}\s+/.test(l)) { out.push('<p><b>' + inline(l.replace(/^#{1,4}\s+/, '')) + '</b></p>'); i++; continue; }
      if (l.trim()) out.push('<p>' + inline(l) + '</p>');
      i++;
    }
    return out.join('');
  }
  function tableHtml(head, rows, raw) {
    const c = (v) => (raw ? v : escapeHtml(v));
    const isNum = (v) => /^[-+$]?[\d,.]+[%KM]?( days| pts)?$|^—$/.test(String(v).replace(/<[^>]+>/g, '').trim());
    return `<div class="chat-table"><table><thead><tr>${head.map((h) => `<th>${c(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((v, j) => `<td class="${j && isNum(v) ? 'n' : ''}">${c(v)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`;
  }

  function addMsg(role, html) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.innerHTML = `<div class="bubble">${html}</div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function chips(list, cls = 'chip') {
    if (!list || !list.length) return '';
    return `<div class="chips">${list.map((s) => `<button type="button" class="${cls}" data-q="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`;
  }

  function greet() {
    const E = window.ChatEngine;
    const api = window.ChainSight ? window.ChainSight.api() : { ai: false };
    addMsg('bot', md("Hi! I'm the **ChainSight Analyst**. Ask me anything about the 6,000 orders in this dashboard: revenue, profit, carriers, delivery times, freight costs, customers.") +
      (api.ai ? '<p class="muted-s">Answers are written by Claude, which queries the data for every number.</p>' : '<p class="muted-s">Answers are calculated from the data in your browser.</p>') +
      chips(E.SUGGESTIONS.slice(0, 6)));
  }

  function renderAnswer(a, el) {
    let html = md(a.text);
    if (a.note) html += `<p class="muted-s">${escapeHtml(a.note)}</p>`;
    let chartId = null;
    if (a.chart && a.chart.values && a.chart.values.length > 1 && a.chart.values.length <= 30) {
      chartId = 'cc' + Math.random().toString(36).slice(2, 8);
      html += `<div class="chat-chart" style="height:${a.chart.type === 'bar' ? Math.min(40 + a.chart.values.length * 26, 300) : 170}px"><canvas id="${chartId}" role="img" aria-label="${escapeHtml(a.chart.label || 'Chart')}"></canvas></div>`;
    }
    if (a.table && a.table.rows && a.table.rows.length) {
      const t = a.table;
      const collapsed = t.rows.length > 8;
      html += `<details class="chat-data"${collapsed ? '' : ' open'}><summary>${collapsed ? `Show the data (${t.rows.length} rows)` : 'Data'}</summary>${tableHtml(t.columns, t.rows)}</details>`;
    }
    const foot = [];
    if (a.applyFilters) foot.push(`<button type="button" class="link-btn apply" >Show this on the dashboard</button>`);
    foot.push(`<span class="src">${a.source === 'claude' ? 'Claude · ' + (a.queries ? a.queries.length : 0) + ' data ' + ((a.queries || []).length === 1 ? 'query' : 'queries') : 'Built-in analyst'}</span>`);
    html += `<div class="msg-foot">${foot.join('')}</div>`;
    html += chips(a.suggestions, 'chip chip-s');
    el.querySelector('.bubble').innerHTML = html;
    if (a.applyFilters) el.querySelector('.apply').addEventListener('click', () => window.ChainSight.applyFilters(a.applyFilters));
    if (chartId) drawChart(chartId, a.chart);
    log.scrollTop = log.scrollHeight;
  }

  function drawChart(id, c) {
    const CS = window.ChainSight;
    const s = CS.series(), text2 = CS.css('--text-2'), grid = CS.css('--grid');
    const f = (v) => (c.format === 'money' ? CS.money(v) : c.format === 'pct' ? v.toFixed(1) + '%' : c.format === 'days' ? v.toFixed(1) + 'd' : Math.round(v).toLocaleString());
    const horizontal = c.type === 'bar';
    const ch = new Chart(document.getElementById(id), {
      type: c.type === 'line' ? 'line' : 'bar',
      data: {
        labels: c.labels,
        datasets: [{ data: c.values, label: c.label, borderColor: s[0], backgroundColor: c.type === 'line' ? s[0] + '22' : c.values.map((v) => (v < 0 ? s[7] : s[0])), fill: c.type === 'line', tension: 0.3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, borderRadius: 4, maxBarThickness: 18 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        indexAxis: horizontal ? 'y' : 'x',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ' ' + f(horizontal ? ctx.parsed.x : ctx.parsed.y) } } },
        scales: {
          x: { grid: { display: horizontal, color: grid }, border: { display: false }, ticks: { color: text2, font: { size: 10.5 }, maxRotation: 0, autoSkipPadding: 8, ...(horizontal ? { callback: (v) => f(v) } : {}) } },
          y: { grid: { display: !horizontal, color: grid }, border: { display: false }, ticks: { color: text2, font: { size: 10.5 }, autoSkip: !horizontal, callback: horizontal ? function (v) { const l = this.getLabelForValue(v); return l.length > 18 ? l.slice(0, 17) + '…' : l; } : (v) => f(v) } },
        },
      },
    });
    charts.push(ch);
  }

  // ---------- asking ----------
  async function ask(q) {
    q = (q || '').trim();
    if (!q || busy) return;
    busy = true;
    $('#chatSend').disabled = true;
    addMsg('user', escapeHtml(q));
    const el = addMsg('bot', '<div class="typing" aria-label="Thinking"><span></span><span></span><span></span></div>');
    let a = null;
    const api = window.ChainSight.api();
    if (api.online) {
      try {
        const r = await fetch('api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q, history }) });
        if (r.ok) a = await r.json();
      } catch (_) { /* fall through to the in-browser analyst */ }
    }
    if (!a) {
      await new Promise((res) => setTimeout(res, 250));
      vocab = vocab || window.ChatEngine.vocabulary(window.ChainSight.rows());
      a = { source: 'built-in', ...window.ChatEngine.answer(window.ChainSight.rows(), q, { vocab }) };
    }
    history.push({ role: 'user', content: q }, { role: 'assistant', content: (a.text || '').slice(0, 2000) });
    renderAnswer(a, el);
    busy = false;
    $('#chatSend').disabled = false;
    input.focus();
  }

  function reset() {
    charts.forEach((c) => c.destroy());
    charts = [];
    history.length = 0;
    log.innerHTML = '';
    greet();
  }

  // ---------- wiring ----------
  function init() {
    const api = window.ChainSight.api();
    $('#chatMode').textContent = api.ai ? 'Powered by Claude · queries the live data' : api.online ? 'Built-in analyst · Node API' : 'Built-in analyst · runs in your browser';
    $('#chatFab').addEventListener('click', toggle);
    $('#askTop').addEventListener('click', open);
    $('#navAsk').addEventListener('click', () => { document.getElementById('sidebar').classList.remove('open'); open(); });
    $('#chatClose').addEventListener('click', close);
    $('#chatClear').addEventListener('click', reset);
    form.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value; input.value = ''; autosize(); ask(q); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    input.addEventListener('input', autosize);
    log.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) ask(b.dataset.q); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) close();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    });
    if (window.__openChat || location.hash === '#ask') open();
  }
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }

  if (window.ChainSight) init();
  else document.addEventListener('chainsight:ready', init, { once: true });
})();
