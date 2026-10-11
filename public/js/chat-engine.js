/**
 * ChainSight chat engine.
 *
 *   runQuery(rows, spec)      Structured query over the orders: metrics × group_by × filters.
 *                             Used by the built-in analyst AND as the `query_sales` tool Claude calls on the server.
 *   answer(rows, question)    Built-in natural-language analyst (no AI needed): parses the question into a spec,
 *                             runs it and writes the answer. Works offline and on GitHub Pages.
 *
 * Runs in the browser (window.ChatEngine) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./analytics.js'));
  else root.ChatEngine = factory(root.Analytics);
})(typeof self !== 'undefined' ? self : this, function (A) {
  // ---------------------------------------------------------------- vocabulary
  const METRICS = {
    revenue: { label: 'Revenue', fmt: 'money', words: ['revenue', 'sales', 'turnover', 'income', 'top line', 'sold'] },
    gross_profit: { label: 'Gross profit', fmt: 'money', words: ['gross profit', 'profit', 'profitable', 'earn', 'earning'] },
    margin_pct: { label: 'Gross margin', fmt: 'pct', words: ['margin'] },
    orders: { label: 'Orders', fmt: 'int', words: ['orders', 'order count', 'number of orders', 'how many orders'] },
    units: { label: 'Units', fmt: 'int', words: ['units', 'quantity', 'volume'] },
    on_time_pct: { label: 'On-time delivery', fmt: 'pct', words: ['on-time', 'on time', 'otd', 'punctual', 'reliab', 'delivery performance', 'service level'] },
    late_orders: { label: 'Late shipments', fmt: 'int', words: ['late', 'delayed', 'delays'] },
    avg_delivery_days: { label: 'Avg delivery time', fmt: 'days', words: ['delivery time', 'lead time', 'delivery days', 'transit time', 'how long', 'delivery speed'] },
    shipping_cost_pct: { label: 'Freight % of revenue', fmt: 'pct', words: ['freight %', 'freight percent', 'shipping cost %', 'freight as', 'cost as a %', 'freight ratio', 'cost ratio'] },
    shipping_cost: { label: 'Freight cost', fmt: 'money', words: ['freight', 'shipping cost', 'logistics cost', 'transport cost', 'expensive', 'cheap'] },
    aov: { label: 'Avg order value', fmt: 'money', words: ['average order value', 'avg order value', 'aov', 'order size', 'basket'] },
    return_rate_pct: { label: 'Return rate', fmt: 'pct', words: ['return rate', 'returns', 'returned'] },
    cancel_rate_pct: { label: 'Cancellation rate', fmt: 'pct', words: ['cancel'] },
    cogs: { label: 'COGS', fmt: 'money', words: ['cogs', 'cost of goods'] },
  };
  const METRIC_KEYS = Object.keys(METRICS);
  // metrics where "best" means lowest
  const LOWER_IS_BETTER = ['avg_delivery_days', 'shipping_cost_pct', 'shipping_cost', 'return_rate_pct', 'cancel_rate_pct', 'late_orders', 'cogs'];

  const DIMS = {
    region: { label: 'Region', words: ['region'] },
    country: { label: 'Country', words: ['country', 'countries', 'market'] },
    warehouse: { label: 'Warehouse', words: ['warehouse', 'hub', 'distribution center', ' dc', 'facility', 'facilities'] },
    product_category: { label: 'Category', words: ['category', 'categories', 'product line'] },
    product_name: { label: 'Product', words: ['product', 'item', 'sku'] },
    customer_segment: { label: 'Segment', words: ['segment', 'channel'] },
    customer_name: { label: 'Customer', words: ['customer', 'client', 'buyer', 'account'] },
    carrier: { label: 'Carrier', words: ['carrier', 'shipper', 'logistics partner', 'transporter'] },
    ship_mode: { label: 'Ship mode', words: ['ship mode', 'shipping mode', 'mode', 'transport mode'] },
    order_status: { label: 'Status', words: ['status'] },
    month: { label: 'Month', words: ['month', 'monthly', 'trend', 'over time', 'timeline'] },
    quarter: { label: 'Quarter', words: ['quarter', 'quarterly'] },
    year: { label: 'Year', words: ['year', 'yearly', 'annual', 'annually'] },
  };
  const FILTER_DIMS = ['region', 'country', 'warehouse', 'product_category', 'product_name', 'customer_segment', 'customer_name', 'carrier', 'ship_mode', 'order_status'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  // ---------------------------------------------------------------- formatting
  const money = (n) => (Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n));
  function fmt(v, kind) {
    if (v == null || !isFinite(v)) return '—';
    if (kind === 'money') return money(v);
    if (kind === 'pct') return v.toFixed(1) + '%';
    if (kind === 'days') return v.toFixed(1) + ' days';
    return Math.round(v).toLocaleString('en-US');
  }
  const fmtMetric = (key, v) => fmt(v, (METRICS[key] || {}).fmt);
  const monthName = (ym) => {
    const [y, m] = ym.split('-');
    return MONTHS[+m - 1].slice(0, 1).toUpperCase() + MONTHS[+m - 1].slice(1, 3) + ' ' + y;
  };
  const keyLabel = (dim, k) => (dim === 'month' ? monthName(k) : String(k));

  // ---------------------------------------------------------------- structured query
  function metricsOf(rows) {
    const k = A.kpis(rows);
    k.late_orders = rows.filter((r) => r.on_time === 'No').length;
    return k;
  }
  function groupKey(dim) {
    if (dim === 'month') return (r) => r.order_date.slice(0, 7);
    if (dim === 'year') return (r) => r.order_date.slice(0, 4);
    if (dim === 'quarter') return (r) => r.order_date.slice(0, 4) + '-Q' + (Math.floor((+r.order_date.slice(5, 7) - 1) / 3) + 1);
    return (r) => r[dim];
  }
  /** Filter rows by a spec's filters. Values may be a string or an array of strings. */
  function filterRows(rows, f = {}) {
    return rows.filter((r) => {
      if (f.from && r.order_date < f.from) return false;
      if (f.to && r.order_date > f.to) return false;
      for (const d of FILTER_DIMS) {
        const v = f[d];
        if (v == null || v === '' || v === 'All') continue;
        if (Array.isArray(v) ? !v.includes(r[d]) : r[d] !== v) return false;
      }
      return true;
    });
  }
  /**
   * spec = { metrics: ['revenue', ...], group_by?: dim|'none', filters?: {...}, sort_by?: metric, order?: 'desc'|'asc', limit?: n }
   * returns { total: {...metrics}, groups?: [{key, ...metrics}], row_count }
   */
  function runQuery(rows, spec = {}) {
    const metrics = (spec.metrics && spec.metrics.length ? spec.metrics : ['revenue']).filter((m) => METRIC_KEYS.includes(m));
    const data = filterRows(rows, spec.filters || {});
    const pick = (o) => Object.fromEntries(metrics.map((m) => [m, round(o[m])]));
    const out = { metrics, filters: spec.filters || {}, row_count: data.length, total: pick(metricsOf(data)) };
    const g = spec.group_by && spec.group_by !== 'none' ? spec.group_by : null;
    if (g) {
      if (!DIMS[g]) return { error: `Unknown group_by '${g}'. Use one of: ${Object.keys(DIMS).join(', ')}` };
      const kf = groupKey(g), m = new Map();
      for (const r of data) { const k = kf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
      let groups = [...m.entries()].map(([key, rs]) => ({ key, ...pick(metricsOf(rs)) }));
      const timeDim = ['month', 'quarter', 'year'].includes(g);
      const sortBy = spec.sort_by && METRIC_KEYS.includes(spec.sort_by) ? spec.sort_by : timeDim ? null : metrics[0];
      if (sortBy) groups.sort((a, b) => (spec.order === 'asc' ? a[sortBy] - b[sortBy] : b[sortBy] - a[sortBy]));
      else groups.sort((a, b) => String(a.key).localeCompare(String(b.key)));
      out.group_by = g;
      out.group_count = groups.length;
      if (spec.limit) groups = groups.slice(0, spec.limit);
      out.groups = groups;
    }
    return out;
  }
  const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

  // ---------------------------------------------------------------- natural-language parsing
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const has = (q, w) => new RegExp('(^|[^a-z])' + esc(w), 'i').test(q);

  function vocabulary(rows) {
    const v = {};
    for (const d of FILTER_DIMS) v[d] = [...new Set(rows.map((r) => r[d]))];
    return v;
  }

  function parse(rows, question, vocab) {
    const q = ' ' + question.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ') + ' ';
    const spec = { metrics: [], filters: {}, intent: 'total' };
    const minDate = rows[0].order_date, maxDate = rows[rows.length - 1].order_date;
    const maxYear = +maxDate.slice(0, 4);

    // --- entity filters (longest names first so "Asia Pacific" beats "Asia")
    const mentioned = {};
    let stripped = q;
    const all = [];
    for (const d of FILTER_DIMS) for (const val of vocab[d]) all.push([d, val]);
    all.sort((a, b) => b[1].length - a[1].length);
    for (const [d, val] of all) {
      const re = new RegExp('(^|[^a-z])' + esc(val.toLowerCase()) + '(?![a-z])', 'i');
      if (re.test(stripped)) {
        (mentioned[d] = mentioned[d] || []).push(val);
        stripped = stripped.replace(re, '$1 ');
      }
    }
    // friendly aliases
    const alias = [['north america', 'region', 'North America'], ['emea', 'region', 'Europe'], ['apac', 'region', 'Asia Pacific'], ['latam', 'region', 'Latin America'], ['mea', 'region', 'Middle East & Africa'],
      ['usa', 'country', 'United States'], [' us ', 'country', 'United States'], [' uk ', 'country', 'United Kingdom'], ['pharma', 'product_category', 'Pharma Supplies'], ['automotive', 'product_category', 'Automotive Parts'], ['industrial', 'product_category', 'Industrial Parts'],
      ['ecommerce', 'customer_segment', 'E-commerce'], ['online', 'customer_segment', 'E-commerce'], ['trucking', 'ship_mode', 'Road'], ['truck', 'ship_mode', 'Road'], ['sea', 'ship_mode', 'Ocean'], ['air freight', 'ship_mode', 'Air'],
      ['singapore hub', 'warehouse', 'Singapore Hub'], ['rotterdam', 'warehouse', 'Rotterdam Hub'], ['dubai', 'warehouse', 'Dubai Hub'], ['dallas', 'warehouse', 'Dallas DC'], ['chicago', 'warehouse', 'Chicago DC'], ['sao paulo', 'warehouse', 'São Paulo DC']];
    for (const [w, d, val] of alias) {
      if (!vocab[d].includes(val)) continue;
      if (has(stripped, w.trim()) && !(mentioned[d] || []).includes(val)) { (mentioned[d] = mentioned[d] || []).push(val); stripped = stripped.replace(new RegExp(esc(w.trim()), 'i'), ' '); }
    }

    // --- time
    const years = [...new Set((q.match(/\b(20\d\d)\b/g) || []).map(Number))];
    if (/\blast year\b|\bprevious year\b|\bprior year\b/.test(q)) years.push(maxYear - 1);
    if (/\bthis year\b|\bcurrent year\b|\blatest year\b|\bytd\b/.test(q)) years.push(maxYear);
    const qm = q.match(/\bq([1-4])\b/);
    const monthHit = MONTHS.findIndex((m) => (m !== 'may' && has(q, m)) || new RegExp('(^|[^a-z])' + m.slice(0, 3) + '[a-z]* 20\\d\\d').test(q));
    const compareYears = years.length >= 2 || /year over year|yoy|vs\.? last year|versus last year|compared to last year/.test(q);
    let timeLabel = '';
    if (!compareYears) {
      const y = years[0];
      if (qm) {
        const yy = y || maxYear, qq = +qm[1];
        spec.filters.from = `${yy}-${String((qq - 1) * 3 + 1).padStart(2, '0')}-01`;
        spec.filters.to = `${yy}-${String(qq * 3).padStart(2, '0')}-${[31, 30, 30, 31][qq - 1]}`;
        timeLabel = `Q${qq} ${yy}`;
      } else if (monthHit >= 0 && (y || /\bin\b|\bduring\b|\bfor\b/.test(q))) {
        const yy = y || maxYear, mm = String(monthHit + 1).padStart(2, '0');
        spec.filters.from = `${yy}-${mm}-01`;
        spec.filters.to = `${yy}-${mm}-31`;
        timeLabel = `${MONTHS[monthHit][0].toUpperCase() + MONTHS[monthHit].slice(1)} ${yy}`;
      } else if (y) {
        spec.filters.from = `${y}-01-01`; spec.filters.to = `${y}-12-31`;
        timeLabel = String(y);
      } else if (/\bpeak season\b|\bholiday\b|\bq4\b/.test(q)) {
        // handled by qm
      }
    } else if (years.length >= 2) {
      spec.filters.from = `${Math.min(...years)}-01-01`; spec.filters.to = `${Math.max(...years)}-12-31`;
    }

    // --- metrics (scan longer phrases first)
    const mList = [];
    for (const key of METRIC_KEYS) for (const w of METRICS[key].words) mList.push([key, w]);
    mList.sort((a, b) => b[1].length - a[1].length);
    let mq = stripped;
    for (const [key, w] of mList) {
      if (has(mq, w)) { if (!spec.metrics.includes(key)) spec.metrics.push(key); mq = mq.replace(new RegExp(esc(w), 'i'), ' '); }
    }
    // "profit margin" → margin only
    if (spec.metrics.includes('margin_pct') && /profit margin/.test(q)) spec.metrics = spec.metrics.filter((m) => m !== 'gross_profit');
    // "most profitable X" → margin? keep gross profit but add margin
    if (/most profitable|least profitable/.test(q) && !spec.metrics.includes('margin_pct')) spec.metrics.push('margin_pct');

    // --- group by
    let groupBy = null;
    const dimOrder = ['product_category', 'product_name', 'customer_segment', 'customer_name', 'ship_mode', 'warehouse', 'carrier', 'country', 'region', 'order_status', 'quarter', 'month', 'year'];
    let gq = stripped;
    // phrases like "by X", "per X", "each X", "which X", "what X", "top X", "best X"
    for (const d of dimOrder) {
      for (const w of DIMS[d].words) {
        if (has(gq, w.trim())) { groupBy = groupBy || d; break; }
      }
    }
    // metric words that look like dims ("product" in "product line") are fine; "delivery time" shouldn't trigger "time"
    // compare intent: two+ values of one dimension → group by that dim limited to them
    const multi = Object.entries(mentioned).find(([, vals]) => vals.length >= 2);
    if (multi) {
      groupBy = multi[0];
      spec.filters[multi[0]] = multi[1];
      spec.intent = 'compare';
    }
    for (const [d, vals] of Object.entries(mentioned)) if (!multi || d !== multi[0]) spec.filters[d] = vals[0];
    if (groupBy && spec.filters[groupBy] && !Array.isArray(spec.filters[groupBy])) {
      // "which warehouse in Europe" fine; but "Europe by region" → drop filter conflict
      if (groupBy === 'region' && !multi) delete spec.filters.region;
    }

    // --- intent
    const n = (q.match(/\b(?:top|bottom|best|worst|first|last)\s+(\d{1,2})\b/) || q.match(/\b(\d{1,2})\s+(?:best|worst|top|largest|biggest|smallest)\b/) || [])[1];
    const wantsHigh = /\b(top|best|highest|most|largest|biggest|leading|max|maximum|strongest|greatest|fastest-growing|leader)\b/.test(q);
    const wantsLow = /\b(bottom|worst|lowest|least|smallest|weakest|poorest|min|minimum|underperform\w*|lagging|slowest)\b/.test(q);
    if (compareYears) { spec.intent = 'growth'; groupBy = groupBy && !['year', 'month', 'quarter'].includes(groupBy) ? groupBy : 'year'; }
    else if (/\b(grow|growth|grew|increase|decline|declin|change|trend|evolv)/.test(q) && !groupBy) { spec.intent = 'growth'; groupBy = 'year'; }
    else if (groupBy === 'month' || groupBy === 'quarter') spec.intent = 'trend';
    else if (spec.intent !== 'compare' && (wantsHigh || wantsLow) && groupBy) spec.intent = 'rank';
    else if (spec.intent !== 'compare' && groupBy) spec.intent = 'breakdown';

    if (/\b(growth|grow|grew)\b/.test(q) && groupBy && !['year', 'month', 'quarter'].includes(groupBy) && years.length < 2) {
      // "which region grew fastest" → growth by dimension between the two years
      spec.intent = 'growth_by';
    }

    // "fastest delivery" is good when low; "slowest" when high
    if (!spec.metrics.length) {
      if (/\b(fast|slow|quick)/.test(q) && !/\b(grow|grew|growth)/.test(q)) spec.metrics.push('avg_delivery_days');
      else if (groupBy === 'carrier' && /\b(best|worst|reliab)/.test(q)) spec.metrics.push('on_time_pct');
      else if (/\bhow many\b|\bcount\b|\bnumber of\b/.test(q)) spec.metrics.push('orders');
      else spec.metrics.push('revenue');
    }
    const primary = spec.metrics[0];
    let order = 'desc';
    const lowerBetter = LOWER_IS_BETTER.includes(primary);
    if (wantsLow && !wantsHigh) order = 'asc';
    if (/\b(best|strongest|leading)\b/.test(q) && lowerBetter) order = 'asc';
    if (/\b(worst|poorest|weakest|underperform\w*|lagging)\b/.test(q) && lowerBetter) order = 'desc';
    if (/\bfastest\b|\bquickest\b/.test(q) && primary === 'avg_delivery_days') order = 'asc';
    if (/\bslowest\b/.test(q) && primary === 'avg_delivery_days') order = 'desc';
    if (/\bcheapest\b|\blowest cost\b/.test(q)) order = 'asc';

    spec.group_by = groupBy || 'none';
    spec.sort_by = ['month', 'quarter', 'year'].includes(groupBy) ? undefined : primary;
    if (spec.intent === 'growth') timeLabel = '';
    spec.order = order;
    if (spec.intent === 'rank') spec.limit = n ? Math.min(+n, 25) : /\b(which|what|who)\b.*\b(is|was|has|had)\b/.test(q) && !/\btop\b|\bbottom\b/.test(q) ? 1 : 5;
    if (spec.intent === 'breakdown' && ['product_name', 'customer_name', 'country'].includes(groupBy)) spec.limit = n ? +n : 10;
    spec.timeLabel = timeLabel;
    spec.minDate = minDate; spec.maxDate = maxDate;
    return spec;
  }

  // ---------------------------------------------------------------- answer writer
  function describeFilters(f, timeLabel) {
    const parts = [];
    for (const d of FILTER_DIMS) {
      const v = f[d];
      if (!v) continue;
      parts.push(Array.isArray(v) ? v.join(' vs ') : v);
    }
    if (timeLabel) parts.push(timeLabel);
    else if (f.from || f.to) parts.push(`${f.from || '…'} to ${f.to || '…'}`);
    return parts.join(' · ');
  }

  const SUGGESTIONS = [
    'What was total revenue in 2025?',
    'Top 5 products by revenue',
    'Which carrier has the worst on-time delivery?',
    'Compare Europe vs Asia Pacific profit',
    'Monthly revenue trend in 2025',
    'How did revenue grow from 2024 to 2025?',
    'Freight % of revenue by ship mode',
    'Which region grew fastest?',
    'Average delivery time for Ocean shipments',
    'Top customers by margin in Q4 2025',
  ];

  function help() {
    return {
      text: "I can answer questions about the 6,000 orders behind this dashboard. Ask about **revenue, profit, margin, orders, on-time delivery, delivery time, freight cost, returns** and more. You can break them down **by region, country, warehouse, category, product, segment, customer, carrier, ship mode, month, quarter or year**, and filter by any name or period (2024, Q4 2025, March 2025…).",
      suggestions: SUGGESTIONS.slice(0, 6),
    };
  }

  function answer(rows, question, opts = {}) {
    const vocab = opts.vocab || vocabulary(rows);
    const raw = (question || '').trim();
    if (!raw) return help();
    if (/^(hi|hello|hey|help|what can you do|\?|examples?)\b/i.test(raw) && raw.length < 40) return help();

    const spec = parse(rows, raw, vocab);
    const m = spec.metrics[0], M = METRICS[m];
    const scope = describeFilters(spec.filters, spec.timeLabel);
    const scopeText = scope ? ` for ${scope}` : '';
    const res = runQuery(rows, spec);
    const out = { spec: { metrics: spec.metrics, group_by: spec.group_by, filters: spec.filters, sort_by: spec.sort_by, order: spec.order, limit: spec.limit }, scope };

    if (!res.row_count) {
      out.text = `I couldn't find any orders${scopeText}. The data covers ${spec.minDate} to ${spec.maxDate}; try a different period or name.`;
      out.suggestions = SUGGESTIONS.slice(0, 3);
      return out;
    }
    const extra = spec.metrics.slice(1);
    const extraText = (o) => (extra.length ? ' (' + extra.map((k) => `${METRICS[k].label.toLowerCase()} ${fmtMetric(k, o[k])}`).join(', ') + ')' : '');

    if (spec.intent === 'growth' && res.groups && spec.group_by === 'year') {
      const g = res.groups;
      if (g.length >= 2) {
        const a = g[0], b = g[g.length - 1];
        const isRate = ['pct', 'days'].includes(M.fmt);
        const delta = isRate ? b[m] - a[m] : ((b[m] - a[m]) / Math.abs(a[m])) * 100;
        const dir = delta >= 0 ? 'rose' : 'fell';
        const chg = isRate ? `${Math.abs(delta).toFixed(1)}${M.fmt === 'pct' ? ' pts' : ' days'}` : `${Math.abs(delta).toFixed(1)}%`;
        const gs = describeFilters({ ...spec.filters, from: undefined, to: undefined }, '');
        out.text = `**${M.label}${gs ? ' (' + gs + ')' : ''} ${dir} ${chg}** from ${fmtMetric(m, a[m])} in ${a.key} to ${fmtMetric(m, b[m])} in ${b.key}.`;
      } else out.text = `Only one year of data matches${scopeText}: ${M.label.toLowerCase()} was ${fmtMetric(m, g[0][m])} in ${g[0].key}.`;
      out.table = table(res, spec);
      out.chart = chart(res, m, 'bar');
    } else if (spec.intent === 'growth_by') {
      const years = [...new Set(rows.map((r) => r.order_date.slice(0, 4)))].sort();
      const y0 = years[0], y1 = years[years.length - 1];
      const r0 = runQuery(rows, { ...spec, limit: undefined, filters: { ...spec.filters, from: `${y0}-01-01`, to: `${y0}-12-31` } });
      const r1 = runQuery(rows, { ...spec, limit: undefined, filters: { ...spec.filters, from: `${y1}-01-01`, to: `${y1}-12-31` } });
      const before = Object.fromEntries(r0.groups.map((g) => [g.key, g[m]]));
      const isRate = ['pct', 'days'].includes(M.fmt);
      const groups = r1.groups.filter((g) => before[g.key] != null).map((g) => ({ key: g.key, a: before[g.key], b: g[m], d: isRate ? g[m] - before[g.key] : ((g[m] - before[g.key]) / Math.abs(before[g.key])) * 100 }));
      groups.sort((x, y) => (/\b(slowest|least|lowest|worst|declin)/.test(raw.toLowerCase()) ? x.d - y.d : y.d - x.d));
      const top = groups[0];
      const unit = isRate ? (M.fmt === 'pct' ? ' pts' : ' days') : '%';
      const slowest = /\b(slowest|least|lowest|worst|declin)/.test(raw.toLowerCase());
      out.text = `**${keyLabel(spec.group_by, top.key)}** ${slowest ? 'grew the least' : 'grew the most'} in ${M.label.toLowerCase()}: ${top.d >= 0 ? '+' : ''}${top.d.toFixed(1)}${unit} (${fmtMetric(m, top.a)} in ${y0} → ${fmtMetric(m, top.b)} in ${y1}).`;
      out.table = { columns: [DIMS[spec.group_by].label, y0, y1, 'Change'], rows: groups.map((g) => [keyLabel(spec.group_by, g.key), fmtMetric(m, g.a), fmtMetric(m, g.b), `${g.d >= 0 ? '+' : ''}${g.d.toFixed(1)}${unit}`]) };
      out.chart = { type: 'bar', labels: groups.map((g) => keyLabel(spec.group_by, g.key)), values: groups.map((g) => +g.d.toFixed(1)), format: isRate ? 'num' : 'pct', label: 'Change ' + y0 + '→' + y1 };
    } else if (spec.intent === 'trend' && res.groups) {
      const g = res.groups;
      const hi = g.reduce((a, b) => (b[m] > a[m] ? b : a)), lo = g.reduce((a, b) => (b[m] < a[m] ? b : a));
      out.text = `${M.label}${scopeText} by ${DIMS[spec.group_by].label.toLowerCase()}: highest in **${keyLabel(spec.group_by, hi.key)}** (${fmtMetric(m, hi[m])}), lowest in ${keyLabel(spec.group_by, lo.key)} (${fmtMetric(m, lo[m])}).`;
      out.chart = chart(res, m, 'line');
      out.table = table(res, spec);
    } else if ((spec.intent === 'rank' || spec.intent === 'breakdown' || spec.intent === 'compare') && res.groups) {
      const g = res.groups, first = g[0];
      const dimL = DIMS[spec.group_by].label.toLowerCase();
      const share = (v) => (M.fmt === 'money' || M.fmt === 'int') && res.total[m] ? ` (${((v / res.total[m]) * 100).toFixed(1)}% of the total)` : '';
      if (spec.intent === 'rank' && spec.limit === 1) {
        const word = spec.order === 'asc' ? (LOWER_IS_BETTER.includes(m) ? 'best' : 'lowest') : LOWER_IS_BETTER.includes(m) ? 'worst' : 'highest';
        out.text = `**${keyLabel(spec.group_by, first.key)}** has the ${word} ${M.label.toLowerCase()}${scopeText}: ${fmtMetric(m, first[m])}${extraText(first)}.`;
        const full = runQuery(rows, { ...spec, limit: undefined });
        const avg = M.fmt === 'money' || M.fmt === 'int' ? null : full.total[m];
        if (avg != null) out.text += ` The overall figure is ${fmtMetric(m, avg)}.`;
        out.table = table(full, spec);
        out.chart = chart(full, m, 'bar');
      } else if (spec.intent === 'compare') {
        const last = g[g.length - 1];
        const diff = M.fmt === 'money' || M.fmt === 'int' ? `${(((first[m] - last[m]) / Math.abs(last[m])) * 100).toFixed(1)}% higher` : `${Math.abs(first[m] - last[m]).toFixed(1)}${M.fmt === 'pct' ? ' pts' : ' days'} higher`;
        const sub = describeFilters({ ...spec.filters, [spec.group_by]: undefined }, spec.timeLabel);
        out.text = `${M.label}${sub ? ' (' + sub + ')' : ''}: **${keyLabel(spec.group_by, first.key)}** ${fmtMetric(m, first[m])} vs ${keyLabel(spec.group_by, last.key)} ${fmtMetric(m, last[m])}, so ${keyLabel(spec.group_by, first.key)} is ${diff}.`;
        out.table = table(res, spec);
        out.chart = chart(res, m, 'bar');
      } else {
        const lead = spec.intent === 'rank' ? `${spec.order === 'asc' ? 'Bottom' : 'Top'} ${g.length} ${dimL === 'category' ? 'categories' : dimL + (dimL.endsWith('s') ? 'es' : 's')} by ${M.label.toLowerCase()}${scopeText}` : `${M.label}${scopeText} by ${dimL}`;
        out.text = `${lead}. **${keyLabel(spec.group_by, first.key)}** ${spec.order === 'asc' ? 'is lowest' : 'leads'} with ${fmtMetric(m, first[m])}${share(first[m])}.`;
        if (res.group_count > g.length) out.text += ` Showing ${g.length} of ${res.group_count}.`;
        out.table = table(res, spec);
        out.chart = chart(res, m, 'bar');
      }
    } else {
      const t = res.total;
      const parts = spec.metrics.map((k) => `${METRICS[k].label.toLowerCase()} ${fmtMetric(k, t[k])}`);
      out.text = `${M.label}${scopeText}: **${fmtMetric(m, t[m])}**${parts.length > 1 ? ', with ' + parts.slice(1).join(', ') : ''}${m === 'orders' ? '' : ` across ${res.row_count.toLocaleString('en-US')} orders`}.`;
      if ((M.fmt === 'money' || M.fmt === 'int') && scope) {
        const base = runQuery(rows, { metrics: [m], filters: { from: spec.filters.from, to: spec.filters.to } });
        if (base.total[m] && base.row_count !== res.row_count) out.text += ` That is ${((t[m] / base.total[m]) * 100).toFixed(1)}% of all ${M.label.toLowerCase()}${spec.timeLabel ? ' in ' + spec.timeLabel : ''}.`;
      } else if (scope && M.fmt !== 'money') {
        const base = runQuery(rows, { metrics: [m] });
        out.text += ` The overall figure across all data is ${fmtMetric(m, base.total[m])}.`;
      }
    }
    // follow-up suggestions related to the question
    out.suggestions = followUps(spec);
    out.applyFilters = dashboardFilters(spec);
    return out;
  }

  function table(res, spec) {
    const g = res.groups || [];
    return {
      columns: [DIMS[spec.group_by].label, ...res.metrics.map((k) => METRICS[k].label)],
      rows: g.map((x) => [keyLabel(spec.group_by, x.key), ...res.metrics.map((k) => fmtMetric(k, x[k]))]),
    };
  }
  function chart(res, m, type) {
    const g = res.groups || [];
    return { type, labels: g.map((x) => keyLabel(res.group_by, x.key)), values: g.map((x) => x[m]), format: METRICS[m].fmt, label: METRICS[m].label };
  }
  function dashboardFilters(spec) {
    const f = {};
    const dashDims = ['region', 'product_category', 'customer_segment', 'ship_mode', 'carrier'];
    for (const d of dashDims) if (spec.filters[d] && !Array.isArray(spec.filters[d])) f[d] = spec.filters[d];
    if (spec.filters.from) f.from = spec.filters.from;
    if (spec.filters.to) f.to = spec.filters.to;
    return Object.keys(f).length ? f : null;
  }
  function followUps(spec) {
    const s = [];
    const m = METRICS[spec.metrics[0]].label.toLowerCase();
    if (spec.group_by !== 'month') s.push(`Monthly ${m} trend${spec.timeLabel ? ' in ' + spec.timeLabel : ''}`);
    if (spec.group_by !== 'carrier') s.push(`${METRICS[spec.metrics[0]].label} by carrier`);
    if (spec.group_by !== 'region') s.push(`Which region has the highest ${m}?`);
    if (spec.metrics[0] !== 'on_time_pct') s.push('Which carrier has the worst on-time delivery?');
    return s.slice(0, 3);
  }

  /** Compact description of the dataset — used in Claude's system prompt. */
  function schema(rows) {
    const vocab = vocabulary(rows);
    const lines = [
      `Orders: ${rows.length}, order_date from ${rows[0].order_date} to ${rows[rows.length - 1].order_date}.`,
      ...FILTER_DIMS.filter((d) => vocab[d].length <= 30).map((d) => `${d}: ${vocab[d].join(', ')}`),
      `metrics: ${METRIC_KEYS.map((k) => `${k} (${METRICS[k].label})`).join(', ')}`,
      `group_by options: ${Object.keys(DIMS).join(', ')}, none`,
    ];
    return lines.join('\n');
  }

  return { METRICS, DIMS, FILTER_DIMS, runQuery, parse, answer, help, schema, vocabulary, SUGGESTIONS, fmtMetric };
});
