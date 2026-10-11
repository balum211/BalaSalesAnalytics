/* ChainSight — Supply Chain Sales Analytics portal (front-end) */
(() => {
  const A = window.Analytics;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const state = {
    all: [],
    rows: [],
    filters: {},
    view: 'overview',
    charts: {},
    orders: { page: 1, size: 25, sort: 'order_date', dir: -1, q: '' },
    apiOnline: false,
    meta: null,
  };

  // Default period = latest full year, so KPI tiles show change vs the prior year
  const DEFAULT_FROM = '2025-01-01', DEFAULT_TO = '2025-12-31';

  const VIEWS = {
    overview: ['Executive Overview', 'Revenue, profitability and service level across the global network'],
    logistics: ['Logistics & Delivery', 'Carrier reliability, lead times, freight cost and warehouse performance'],
    products: ['Products & Customers', 'What sells, what earns margin, and who buys'],
    orders: ['Orders Explorer', 'Search, sort and export order-level detail'],
    insights: ['AI Insights', 'Automatically generated findings for the current filter'],
    powerbi: ['BI Report', 'Interactive Looker Studio report on the same data'],
  };

  // ---------- formatting ----------
  const money = (n) => A.fmtMoney(n);
  const moneyFull = (n) => '$' + Math.round(n).toLocaleString();
  const pct = (n, d = 1) => n.toFixed(d) + '%';
  const int = (n) => Math.round(n).toLocaleString();
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ---------- storage (safe) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };

  // ---------- theme ----------
  function setTheme(name) {
    if (!window.THEMES[name]) name = 'horizon';
    document.documentElement.setAttribute('data-skin', name);
    store.set('cs-theme-v2', name);
    $$('.swatch').forEach((s) => s.setAttribute('aria-checked', s.dataset.theme === name ? 'true' : 'false'));
    if (state.rows.length) renderView();
  }
  function buildThemeSwatches() {
    const wrap = $('#themeSwatches');
    Object.entries(window.THEMES).forEach(([key, t]) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.theme = key;
      b.title = t.label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', t.label + ' theme');
      b.innerHTML = `<span style="background:linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)"></span>`;
      b.addEventListener('click', () => setTheme(key));
      wrap.appendChild(b);
    });
  }
  const series = () => window.SERIES[window.THEMES[document.documentElement.dataset.skin]?.mode === 'light' ? 'light' : 'dark'];

  // ---------- charts ----------
  function baseOptions(extra = {}) {
    const text2 = css('--text-2'), grid = css('--grid'), panel = css('--panel'), text = css('--text'), border = css('--border');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: text2, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 14, font: { family: 'Plus Jakarta Sans', weight: '600', size: 12 } } },
        tooltip: {
          backgroundColor: panel, titleColor: text, bodyColor: text2, borderColor: border, borderWidth: 1,
          padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true,
          titleFont: { family: 'Plus Jakarta Sans', weight: '700' }, bodyFont: { family: 'JetBrains Mono', size: 12 },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: grid }, ticks: { color: text2, font: { size: 11.5 }, maxRotation: 0, autoSkipPadding: 12 } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: text2, font: { size: 11.5 } } },
      },
      ...extra,
    };
  }
  function draw(id, config) {
    if (state.charts[id]) state.charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    state.charts[id] = new Chart(el, config);
  }
  const monthLabel = (m) => {
    const [y, mo] = m.split('-');
    return new Date(Date.UTC(+y, +mo - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + " '" + y.slice(2);
  };
  // Horizontal bar with one color per entity (color follows entity, fixed order from full dataset)
  function hBar(id, groups, valueKey, fmt, colorFor, dim) {
    draw(id, {
      type: 'bar',
      data: {
        labels: groups.map((g) => g.key),
        datasets: [{ data: groups.map((g) => g[valueKey]), backgroundColor: groups.map((g) => colorFor(g.key)), borderRadius: 4, borderSkipped: 'start', barThickness: 'flex', maxBarThickness: 26 }],
      },
      options: baseOptions({
        indexAxis: 'y',
        ...clickable(dim, groups.map((g) => g.key)),
        plugins: { ...baseOptions().plugins, legend: { display: false }, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => ' ' + fmt(c.parsed.x), footer: () => (dim ? 'Click to filter' : '') } } },
        scales: {
          x: { ...baseOptions().scales.y, ticks: { ...baseOptions().scales.y.ticks, callback: (v) => fmt(v) } },
          y: { ...baseOptions().scales.x, ticks: { ...baseOptions().scales.x.ticks, autoSkip: false } },
        },
      }),
    });
  }
  // Click a mark → filter the whole dashboard by that entity (click again to clear)
  function clickable(dim, keys) {
    if (!dim) return {};
    return {
      onClick: (_e, els) => { if (els.length) setDimFilter(dim, keys[els[0].index]); },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    };
  }
  const DIM_LABEL = { region: 'Region', product_category: 'Category', customer_segment: 'Segment', ship_mode: 'Ship mode', carrier: 'Carrier', warehouse: 'Warehouse' };
  function setDimFilter(dim, value) {
    if (state.filters[dim] === value) delete state.filters[dim];
    else state.filters[dim] = value;
    const sel = document.querySelector(`.filters select[data-dim="${dim}"]`);
    if (sel) sel.value = state.filters[dim] || 'All';
    update();
  }
  function renderChips() {
    const box = $('#activeChips');
    const active = Object.keys(DIM_LABEL).filter((d) => state.filters[d] && state.filters[d] !== 'All');
    box.hidden = !active.length;
    box.innerHTML = active.length
      ? '<span class="chips-label">Filtered by</span>' + active.map((d) => `<button type="button" class="fchip" data-dim="${d}" title="Remove this filter">${DIM_LABEL[d]}: <b>${state.filters[d]}</b> <span aria-hidden="true">✕</span></button>`).join('') + '<button type="button" class="fchip-clear" id="chipsClear">Clear all</button>'
      : '';
  }
  // Stable entity → color mapping
  const colorMap = {};
  function colorFor(dim) {
    return (key) => {
      const order = state.meta[dim] || [];
      const i = order.indexOf(key);
      return series()[(i < 0 ? 0 : i) % 8];
    };
  }

  // ---------- data loading ----------
  async function load() {
    const res = await fetch('data/orders.json');
    state.all = A.hydrate(await res.json());
    const meta = { minDate: state.all[0].order_date, maxDate: state.all[state.all.length - 1].order_date };
    A.DIMENSIONS.forEach((d) => (meta[d] = A.distinct(state.all, d)));
    // fixed entity order = revenue rank on the full dataset
    ['region', 'product_category', 'customer_segment', 'ship_mode', 'carrier', 'warehouse'].forEach((d) => (meta[d] = A.groupBy(state.all, d).map((g) => g.key)));
    state.meta = meta;
    try {
      const h = await fetch('api/health', { cache: 'no-store' });
      if (h.ok) { const j = await h.json(); state.apiOnline = true; state.aiEnabled = j.ai; }
    } catch (_) {}
    const s = $('#apiStatus');
    s.textContent = state.apiOnline ? 'Node API live' : 'Static mode';
    s.classList.toggle('on', state.apiOnline);
    s.title = state.apiOnline ? 'Served by the Node.js/Express server' : 'Served as static files (e.g. GitHub Pages)';
  }

  // ---------- filters ----------
  function buildFilters() {
    $$('.filters select').forEach((sel) => {
      const d = sel.dataset.dim;
      sel.innerHTML = '<option value="All">All</option>' + [...state.meta[d]].sort().map((v) => `<option>${v}</option>`).join('');
      sel.addEventListener('change', () => { state.filters[d] = sel.value; update(); });
    });
    const from = $('#fFrom'), to = $('#fTo');
    [from, to].forEach((el) => { el.min = state.meta.minDate; el.max = state.meta.maxDate; });
    from.value = DEFAULT_FROM; to.value = DEFAULT_TO;
    from.addEventListener('change', () => { state.filters.from = from.value; markQuick(); update(); });
    to.addEventListener('change', () => { state.filters.to = to.value; markQuick(); update(); });
    $$('.quick button').forEach((b) => b.addEventListener('click', () => {
      const r = b.dataset.range;
      from.value = r === 'all' ? state.meta.minDate : `${r}-01-01`;
      to.value = r === 'all' ? state.meta.maxDate : `${r}-12-31`;
      state.filters.from = from.value; state.filters.to = to.value;
      markQuick(); update();
    }));
    $('#resetBtn').addEventListener('click', resetFilters);
    $('#emptyReset').addEventListener('click', resetFilters);
    state.filters = { from: from.value, to: to.value };
    markQuick();
  }
  function markQuick() {
    const f = $('#fFrom').value, t = $('#fTo').value;
    $$('.quick button').forEach((b) => {
      const r = b.dataset.range;
      const on = r === 'all' ? f === state.meta.minDate && t >= state.meta.maxDate : f === `${r}-01-01` && t === `${r}-12-31`;
      b.classList.toggle('on', on);
    });
  }
  function resetFilters() {
    $$('.filters select').forEach((s) => (s.value = 'All'));
    $('#fFrom').value = DEFAULT_FROM; $('#fTo').value = DEFAULT_TO;
    state.filters = { from: DEFAULT_FROM, to: DEFAULT_TO };
    state.orders.q = ''; $('#orderSearch').value = '';
    markQuick(); update();
  }

  function update() {
    state.rows = A.applyFilters(state.all, state.filters);
    state.orders.page = 1;
    $('#rowCount').textContent = int(state.rows.length) + ' orders';
    renderChips();
    const empty = state.rows.length === 0 && state.view !== 'powerbi';
    $('#emptyState').hidden = !empty;
    document.body.classList.toggle('is-empty', empty);
    if (!empty) renderView();
  }

  // ---------- navigation ----------
  function go(view) {
    state.view = view;
    $$('.nav-item[data-view]').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $('#viewTitle').textContent = VIEWS[view][0];
    $('#viewSubtitle').textContent = VIEWS[view][1];
    $('.filters').style.display = view === 'powerbi' ? 'none' : '';
    $('#sidebar').classList.remove('open');
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    update();
  }

  function renderView() {
    ({ overview: renderOverview, logistics: renderLogistics, products: renderProducts, orders: renderOrders, insights: renderInsights, powerbi: renderPowerBI })[state.view]();
  }

  // ---------- KPI tiles ----------
  function sparkline(values, good) {
    if (!values || values.length < 2) return '';
    const w = 120, h = 34, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L${w} ${h} L0 ${h}Z" class="spark-area"/><path d="${d}" class="spark-line"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" class="spark-dot"/></svg>`;
  }
  function kpiTile(label, value, delta, goodWhenUp = true, deltaFmt = (d) => pct(Math.abs(d)), spark) {
    let d = '';
    if (delta != null && isFinite(delta)) {
      const up = delta >= 0;
      const good = up === goodWhenUp;
      d = `<div class="kpi-delta ${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${deltaFmt(delta)} <span class="vs">vs prior period</span></div>`;
    } else d = '<div class="kpi-delta"><span class="vs">no prior period in data</span></div>';
    return `<div class="kpi${spark ? ' has-spark' : ''}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${d}${spark ? sparkline(spark) : ''}</div>`;
  }
  function priorKpis() {
    const f = state.filters;
    if (!f.from || !f.to) return null;
    const w = A.previousWindow(f.from, f.to);
    if (w.to < state.meta.minDate) return null;
    const prev = A.applyFilters(state.all, { ...f, from: w.from, to: w.to });
    if (!prev.length || w.from < state.meta.minDate) return null;
    return A.kpis(prev);
  }
  const chg = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);

  // ---------- Overview ----------
  function renderOverview() {
    const k = A.kpis(state.rows), p = priorKpis();
    const pts = (d) => Math.abs(d).toFixed(1) + ' pts';
    const m = A.monthly(state.rows), s = series();
    const sp = (key) => m.map((x) => x[key]);
    $('#kpiGrid').innerHTML = [
      kpiTile('Revenue', money(k.revenue), p && chg(k.revenue, p.revenue), true, undefined, sp('revenue')),
      kpiTile('Gross profit', money(k.gross_profit), p && chg(k.gross_profit, p.gross_profit), true, undefined, sp('gross_profit')),
      kpiTile('Gross margin', pct(k.margin_pct), p && k.margin_pct - p.margin_pct, true, pts, sp('margin_pct')),
      kpiTile('Orders', int(k.orders), p && chg(k.orders, p.orders), true, undefined, sp('orders')),
      kpiTile('On-time delivery', pct(k.on_time_pct), p && k.on_time_pct - p.on_time_pct, true, pts, sp('on_time_pct')),
      kpiTile('Avg delivery time', k.avg_delivery_days.toFixed(1) + ' days', p && chg(k.avg_delivery_days, p.avg_delivery_days), false, undefined, sp('avg_delivery_days')),
    ].join('');

    draw('cTrend', {
      type: 'line',
      data: {
        labels: m.map((x) => monthLabel(x.key)),
        datasets: [
          { label: 'Revenue', data: m.map((x) => x.revenue), borderColor: s[0], backgroundColor: s[0] + '22', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 },
          { label: 'Gross profit', data: m.map((x) => x.gross_profit), borderColor: s[1], backgroundColor: s[1], tension: 0.3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 },
        ],
      },
      options: baseOptions({
        plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: ${moneyFull(c.parsed.y)}` } } },
        scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, beginAtZero: true, ticks: { ...baseOptions().scales.y.ticks, callback: (v) => money(v) } } },
      }),
    });
    hBar('cRegion', A.groupBy(state.rows, 'region'), 'revenue', money, colorFor('region'), 'region');
    hBar('cCategory', A.groupBy(state.rows, 'product_category'), 'revenue', money, colorFor('product_category'), 'product_category');
    donut('cSegment', A.groupBy(state.rows, 'customer_segment'), 'revenue', colorFor('customer_segment'), 'customer_segment', '#segLegend');
    heatmap();
  }

  function donut(id, groups, key, colorOf, dim, legendSel) {
    const total = groups.reduce((a, g) => a + g[key], 0) || 1;
    draw(id, {
      type: 'doughnut',
      data: { labels: groups.map((g) => g.key), datasets: [{ data: groups.map((g) => g[key]), backgroundColor: groups.map((g) => colorOf(g.key)), borderColor: css('--panel'), borderWidth: 3, hoverOffset: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '66%', animation: { duration: 350 },
        ...clickable(dim, groups.map((g) => g.key)),
        plugins: { legend: { display: false }, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => ` ${c.label}: ${money(c.parsed)} (${((c.parsed / total) * 100).toFixed(1)}%)`, footer: () => 'Click to filter' } } },
      },
      plugins: [{ id: 'center', afterDraw(ch) { const { ctx, chartArea: a } = ch; const cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2; ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = css('--muted'); ctx.font = '700 10.5px Plus Jakarta Sans, system-ui, sans-serif'; ctx.fillText('TOTAL', cx, cy - 10); ctx.fillStyle = css('--text'); ctx.font = '600 19px JetBrains Mono, monospace'; ctx.fillText(money(total), cx, cy + 14); ctx.restore(); } }],
    });
    $(legendSel).innerHTML = groups.map((g) => `<button type="button" class="leg" data-dim="${dim}" data-val="${g.key}"><i style="background:${colorOf(g.key)}"></i><span>${g.key}</span><b>${money(g[key])}</b><em>${((g[key] / total) * 100).toFixed(1)}%</em></button>`).join('');
  }

  // Region × category revenue heatmap (click a cell to filter both)
  function heatmap() {
    const regions = state.meta.region.filter((r) => state.rows.some((x) => x.region === r));
    const cats = state.meta.product_category.filter((c) => state.rows.some((x) => x.product_category === c));
    const cell = {};
    let max = 0;
    for (const r of state.rows) { const k = r.region + '|' + r.product_category; cell[k] = (cell[k] || 0) + (r.revenue || 0); }
    Object.values(cell).forEach((v) => (max = Math.max(max, v)));
    const short = { 'Middle East & Africa': 'ME & Africa', 'North America': 'N. America', 'Latin America': 'LatAm', 'Asia Pacific': 'Asia Pacific' };
    let html = `<div class="hm" style="grid-template-columns: minmax(96px, 1.2fr) repeat(${cats.length}, minmax(64px, 1fr))"><div></div>`;
    html += cats.map((c) => `<div class="hm-col">${c.replace(' Supplies', '').replace(' Parts', '').replace(' Goods', '')}</div>`).join('');
    for (const r of regions) {
      html += `<div class="hm-row">${short[r] || r}</div>`;
      for (const c of cats) {
        const v = cell[r + '|' + c] || 0, t = max ? v / max : 0;
        const strong = t > 0.55;
        html += `<button type="button" class="hm-cell${strong ? ' strong' : ''}" style="--t:${Math.round(8 + t * 82)}%" data-region="${r}" data-cat="${c}" title="${r} · ${c}: ${moneyFull(v)} (click to filter)">${money(v)}</button>`;
      }
    }
    html += '</div>';
    $('#heatmap').innerHTML = html;
  }

  // ---------- Logistics ----------
  function renderLogistics() {
    const k = A.kpis(state.rows), p = priorKpis();
    const pts = (d) => Math.abs(d).toFixed(1) + ' pts';
    const late = state.rows.filter((r) => r.on_time === 'No').length;
    $('#kpiLogistics').innerHTML = [
      kpiTile('On-time delivery', pct(k.on_time_pct), p && k.on_time_pct - p.on_time_pct, true, pts),
      kpiTile('Avg delivery time', k.avg_delivery_days.toFixed(1) + ' days', p && chg(k.avg_delivery_days, p.avg_delivery_days), false),
      kpiTile('Late shipments', int(late), null),
      kpiTile('Freight cost', money(k.shipping_cost), p && chg(k.shipping_cost, p.shipping_cost), false),
      kpiTile('Freight % of revenue', pct(k.shipping_cost_pct), p && k.shipping_cost_pct - p.shipping_cost_pct, false, pts),
      kpiTile('Return rate', pct(k.return_rate_pct), p && k.return_rate_pct - p.return_rate_pct, false, pts),
    ].join('');

    const s = series();
    const carriers = A.groupBy(state.rows, 'carrier', 'on_time_pct');
    const cf = colorFor('carrier');
    draw('cCarrier', {
      type: 'bar',
      data: { labels: carriers.map((c) => c.key.split(' ')), datasets: [{ label: 'On-time %', data: carriers.map((c) => c.on_time_pct), backgroundColor: carriers.map((c) => cf(c.key)), borderRadius: 4, maxBarThickness: 46 }] },
      options: baseOptions({
        ...clickable('carrier', carriers.map((c) => c.key)),
        plugins: { ...baseOptions().plugins, legend: { display: false }, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => ' On-time: ' + pct(c.parsed.y) } } },
        scales: { x: { ...baseOptions().scales.x, ticks: { ...baseOptions().scales.x.ticks, autoSkip: false } }, y: { ...baseOptions().scales.y, min: 50, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: (v) => v + '%' } } },
      }),
      plugins: [targetLine(90)],
    });

    const modes = A.groupBy(state.rows, 'ship_mode');
    const promised = modes.map((m) => avg(state.rows.filter((r) => r.ship_mode === m.key), 'promised_days'));
    draw('cLead', {
      type: 'bar',
      data: {
        labels: modes.map((m) => m.key),
        datasets: [
          { label: 'Promised', data: promised, backgroundColor: s[0], borderRadius: 4, maxBarThickness: 34 },
          { label: 'Actual', data: modes.map((m) => m.avg_delivery_days), backgroundColor: s[1], borderRadius: 4, maxBarThickness: 34 },
        ],
      },
      options: baseOptions({
        plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)} days` } } },
        scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, beginAtZero: true, ticks: { ...baseOptions().scales.y.ticks, callback: (v) => v + 'd' } } },
      }),
    });

    const m = A.monthly(state.rows);
    draw('cOtdTrend', {
      type: 'line',
      data: { labels: m.map((x) => monthLabel(x.key)), datasets: [{ label: 'On-time %', data: m.map((x) => x.on_time_pct), borderColor: s[2], backgroundColor: s[2] + '22', fill: true, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 5 }] },
      options: baseOptions({
        plugins: { ...baseOptions().plugins, legend: { display: false }, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => ' On-time: ' + pct(c.parsed.y) } } },
        scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, min: 60, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: (v) => v + '%' } } },
      }),
      plugins: [targetLine(90)],
    });

    const fm = A.groupBy(state.rows, 'ship_mode', 'shipping_cost_pct');
    hBar('cFreight', fm, 'shipping_cost_pct', (v) => pct(v), colorFor('ship_mode'), 'ship_mode');

    const wh = A.groupBy(state.rows, 'warehouse');
    const maxRev = Math.max(...wh.map((w) => w.revenue));
    table('#tWarehouse', [
      { k: 'key', t: 'Warehouse' },
      { k: 'orders', t: 'Orders', n: 1, f: int },
      { k: 'revenue', t: 'Revenue', n: 1, f: (v) => `<span class="bar-cell"><i style="width:${(v / maxRev) * 80}px"></i>${money(v)}</span>` },
      { k: 'margin_pct', t: 'Margin', n: 1, f: (v) => pct(v) },
      { k: 'on_time_pct', t: 'On-time', n: 1, f: (v) => otdBadge(v) },
      { k: 'avg_delivery_days', t: 'Avg days', n: 1, f: (v) => v.toFixed(1) },
      { k: 'shipping_cost_pct', t: 'Freight %', n: 1, f: (v) => pct(v) },
    ], wh);
  }
  const avg = (rows, k) => { const v = rows.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  const otdBadge = (v) => {
    const c = v >= 90 ? 'good' : v >= 85 ? 'warn' : 'bad';
    const i = c === 'good' ? '●' : c === 'warn' ? '▲' : '■';
    return `<span class="badge ${c}">${i} ${pct(v)}</span>`;
  };
  function targetLine(value) {
    return {
      id: 'target' + value,
      afterDatasetsDraw(chart) {
        const y = chart.scales.y.getPixelForValue(value), { left, right } = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = css('--muted'); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.25;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = css('--text-2'); ctx.font = '600 11px Plus Jakarta Sans';
        ctx.textAlign = 'right'; ctx.fillText('Target ' + value + '%', right, y - 5);
        ctx.restore();
      },
    };
  }

  // ---------- Products ----------
  function renderProducts() {
    const s = series();
    const prods = A.groupBy(state.rows, 'product_name').slice(0, 10);
    const cc = colorFor('product_category');
    hBar('cProducts', prods, 'revenue', money, () => s[0]);
    const cats = A.groupBy(state.rows, 'product_category', 'margin_pct');
    hBar('cMargin', cats, 'margin_pct', (v) => pct(v), cc, 'product_category');

    const cust = A.groupBy(state.rows, 'customer_name').slice(0, 12);
    const segOf = Object.fromEntries(state.all.map((r) => [r.customer_name, r.customer_segment]));
    const maxRev = Math.max(...cust.map((c) => c.revenue));
    table('#tCustomers', [
      { k: 'rank', t: '#', n: 1 },
      { k: 'key', t: 'Customer' },
      { k: 'segment', t: 'Segment' },
      { k: 'orders', t: 'Orders', n: 1, f: int },
      { k: 'revenue', t: 'Revenue', n: 1, f: (v) => `<span class="bar-cell"><i style="width:${(v / maxRev) * 80}px"></i>${money(v)}</span>` },
      { k: 'aov', t: 'Avg order', n: 1, f: money },
      { k: 'margin_pct', t: 'Margin', n: 1, f: (v) => pct(v) },
      { k: 'on_time_pct', t: 'On-time', n: 1, f: otdBadge },
    ], cust.map((c, i) => ({ ...c, rank: i + 1, segment: segOf[c.key] })));
    void s;
  }

  // ---------- Generic table ----------
  function table(sel, cols, rows) {
    const el = $(sel);
    el.innerHTML = `<thead><tr>${cols.map((c) => `<th class="${c.n ? 'n' : ''}">${c.t}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr${r.key != null ? ` data-key="${r.key}" class="${state.filters.warehouse === r.key ? 'sel' : ''}"` : ''}>${cols.map((c) => `<td class="${c.n ? 'n' : ''}">${c.f ? c.f(r[c.k]) : r[c.k]}</td>`).join('')}</tr>`).join('')}</tbody>`;
  }

  // ---------- Orders explorer ----------
  const ORDER_COLS = [
    { k: 'order_id', t: 'Order' }, { k: 'order_date', t: 'Date' }, { k: 'customer_name', t: 'Customer' },
    { k: 'product_name', t: 'Product' }, { k: 'region', t: 'Region' },
    { k: 'carrier', t: 'Carrier' }, { k: 'ship_mode', t: 'Mode' },
    { k: 'quantity', t: 'Qty', n: 1, f: int }, { k: 'revenue', t: 'Revenue', n: 1, f: moneyFull },
    { k: 'gross_profit', t: 'Profit', n: 1, f: moneyFull },
    { k: 'actual_days', t: 'Days', n: 1, f: (v) => (v == null ? '—' : v) },
    { k: 'on_time', t: 'On time', f: (v) => (v === 'Yes' ? '<span class="badge good">● Yes</span>' : v === 'No' ? '<span class="badge bad">■ Late</span>' : '<span class="muted">—</span>') },
    { k: 'order_status', t: 'Status' },
  ];
  function orderRows() {
    const o = state.orders;
    const rows = o.q ? A.applyFilters(state.rows, { q: o.q }) : state.rows.slice();
    rows.sort((a, b) => {
      const x = a[o.sort], y = b[o.sort];
      if (x == null) return 1; if (y == null) return -1;
      return ((x > y ? 1 : x < y ? -1 : 0) || (a.order_id > b.order_id ? 1 : -1)) * o.dir;
    });
    return rows;
  }
  function renderOrders() {
    const o = state.orders, rows = orderRows();
    const pages = Math.max(1, Math.ceil(rows.length / o.size));
    o.page = Math.min(o.page, pages);
    const slice = rows.slice((o.page - 1) * o.size, o.page * o.size);
    const el = $('#tOrders');
    el.innerHTML = `<thead><tr>${ORDER_COLS.map((c) => `<th data-k="${c.k}" class="${c.n ? 'n' : ''}" aria-sort="${o.sort === c.k ? (o.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.t}${o.sort === c.k ? `<span class="arr">${o.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${slice.length ? slice.map((r) => `<tr>${ORDER_COLS.map((c) => `<td class="${c.n ? 'n' : ''}">${c.f ? c.f(r[c.k]) : r[c.k]}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${ORDER_COLS.length}" class="muted" style="text-align:center;padding:30px">No orders match “${escapeHtml(o.q)}”.</td></tr>`}</tbody>`;
    el.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (o.sort === k) o.dir *= -1; else { o.sort = k; o.dir = 1; }
      renderOrders();
    }));
    $('#pageInfo').textContent = rows.length ? `Showing ${int((o.page - 1) * o.size + 1)}–${int(Math.min(o.page * o.size, rows.length))} of ${int(rows.length)} orders` : '0 orders';
    $('#prevPage').disabled = o.page <= 1;
    $('#nextPage').disabled = o.page >= pages;
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function exportCsv() {
    const rows = orderRows();
    const cols = ['order_id', 'order_date', 'ship_date', 'delivery_date', 'region', 'country', 'warehouse', 'customer_segment', 'customer_name', 'product_category', 'product_name', 'ship_mode', 'carrier', 'quantity', 'unit_price', 'discount', 'revenue', 'cogs', 'shipping_cost', 'gross_profit', 'promised_days', 'actual_days', 'on_time', 'order_status'];
    const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `orders_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast(`Exported ${int(rows.length)} orders`);
  }

  // ---------- Insights ----------
  async function renderInsights(force) {
    const list = $('#insightList');
    let items = A.insights(state.rows), source = 'Rule-based analysis of the filtered data (runs in your browser).';
    if (state.apiOnline && state.aiEnabled && force) {
      list.innerHTML = '<div class="insight"><p>Asking Claude for an executive summary…</p></div>';
      try {
        const r = await fetch('api/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state.filters) });
        const j = await r.json();
        items = j.insights;
        source = j.source === 'claude' ? 'Written by Claude from aggregated metrics (no raw rows sent).' : 'Claude unavailable — showing rule-based analysis.';
      } catch (_) {}
    } else if (state.apiOnline && state.aiEnabled) {
      source += ' Click “Regenerate” to ask Claude.';
    }
    $('#insightSource').textContent = source;
    const icon = { growth: '▲ Opportunity', risk: '■ Risk', cost: '◆ Cost', headline: '● Summary' };
    list.innerHTML = items.map((i) => `<div class="insight ${i.type}"><span class="tag">${icon[i.type] || '●'}</span><h4>${escapeHtml(i.title)}</h4><p>${escapeHtml(i.text)}</p></div>`).join('');
  }

  // ---------- Power BI ----------
  function renderPowerBI() {
    const cfg = window.APP_CONFIG || {};
    const url = cfg.LOOKER_EMBED_URL || cfg.POWERBI_EMBED_URL;
    const box = $('#pbiFrame');
    if (url) {
      box.innerHTML = `<iframe title="Supply chain sales BI report" src="${encodeURI(url)}" allowfullscreen loading="lazy"></iframe>`;
      const view = cfg.LOOKER_VIEW_URL || url.replace('/embed/', '/');
      $('#lookerOpen').innerHTML = `<a class="btn" href="${encodeURI(view)}" target="_blank" rel="noopener">Open the report in Looker Studio ↗</a>`;
    } else {
      box.innerHTML = '<div style="padding:30px;text-align:center"><div style="font-size:34px">▣</div><b>BI report not linked yet</b><br/><span>Add your Looker Studio embed URL as <code>LOOKER_EMBED_URL</code> in <code>public/js/config.js</code>.</span></div>';
      $('#lookerOpen').innerHTML = '';
    }
  }


  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- boot ----------
  async function init() {
    Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
    buildThemeSwatches();
    setTheme(store.get('cs-theme-v2') || (window.APP_CONFIG || {}).DEFAULT_THEME || 'horizon');
    await load();
    buildFilters();
    $$('.nav-item[data-view]').forEach((n) => n.addEventListener('click', () => go(n.dataset.view)));
    $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    let deb;
    $('#orderSearch').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { state.orders.q = e.target.value; state.orders.page = 1; renderOrders(); }, 150); });
    $('#prevPage').addEventListener('click', () => { state.orders.page--; renderOrders(); });
    $('#nextPage').addEventListener('click', () => { state.orders.page++; renderOrders(); });
    $('#exportBtn').addEventListener('click', exportCsv);
    $('#refreshInsights').addEventListener('click', () => renderInsights(true));
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.fchip');
      if (chip) return setDimFilter(chip.dataset.dim, state.filters[chip.dataset.dim]);
      if (e.target.closest('#chipsClear')) { Object.keys(DIM_LABEL).forEach((d) => delete state.filters[d]); $$('.filters select').forEach((x) => (x.value = 'All')); return update(); }
      const leg = e.target.closest('.leg');
      if (leg) return setDimFilter(leg.dataset.dim, leg.dataset.val);
      const hm = e.target.closest('.hm-cell');
      if (hm) {
        const same = state.filters.region === hm.dataset.region && state.filters.product_category === hm.dataset.cat;
        if (same) { delete state.filters.region; delete state.filters.product_category; }
        else { state.filters.region = hm.dataset.region; state.filters.product_category = hm.dataset.cat; }
        $$('.filters select').forEach((x) => (x.value = state.filters[x.dataset.dim] || 'All'));
        return update();
      }
      const wh = e.target.closest('#tWarehouse tbody tr');
      if (wh) return setDimFilter('warehouse', wh.dataset.key);
    });
    window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== state.view) go(v); });
    const initial = location.hash.slice(1);
    window.__openChat = initial === 'ask';
    go(VIEWS[initial] ? initial : 'overview');

    // Public hooks for the chat assistant (js/chat-ui.js)
    window.ChainSight = {
      rows: () => state.all,
      filters: () => ({ ...state.filters }),
      api: () => ({ online: state.apiOnline, ai: !!state.aiEnabled }),
      series,
      css,
      money,
      applyFilters(f) {
        $$('.filters select').forEach((sel) => { sel.value = f[sel.dataset.dim] || 'All'; });
        $('#fFrom').value = f.from || state.meta.minDate;
        $('#fTo').value = f.to && f.to <= state.meta.maxDate ? f.to : state.meta.maxDate;
        state.filters = { from: $('#fFrom').value, to: $('#fTo').value };
        $$('.filters select').forEach((sel) => { if (sel.value !== 'All') state.filters[sel.dataset.dim] = sel.value; });
        markQuick();
        if (state.view === 'powerbi' || state.view === 'insights') go('overview'); else update();
        toast('Dashboard filtered to match the answer');
      },
    };
    document.dispatchEvent(new Event('chainsight:ready'));
  }
  init().catch((e) => {
    console.error(e);
    document.querySelector('.main').insertAdjacentHTML('afterbegin', `<div class="empty"><h2>Could not load data</h2><p>${e.message}</p></div>`);
  });
})();
