/**
 * Shared analytics engine — runs in the browser (window.Analytics) and in Node (require).
 * All KPI math lives here so the web portal, the REST API and the docs agree on definitions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Analytics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DIMENSIONS = ['region', 'product_category', 'customer_segment', 'ship_mode', 'carrier', 'warehouse', 'order_status'];
  const NUMERIC = ['quantity', 'unit_price', 'discount', 'revenue', 'cogs', 'shipping_cost', 'gross_profit', 'promised_days', 'actual_days'];

  /** Convert the columnar JSON ({columns, rows}) into an array of objects with typed numbers. */
  function hydrate(payload) {
    const cols = payload.columns;
    return payload.rows.map((r) => {
      const o = {};
      cols.forEach((c, i) => {
        let v = r[i];
        if (NUMERIC.includes(c)) v = v === '' || v === null ? null : Number(v);
        o[c] = v;
      });
      o.month = o.order_date.slice(0, 7);
      return o;
    });
  }

  /** filters: { from, to, region, product_category, customer_segment, ship_mode, carrier, warehouse, order_status, q } */
  function applyFilters(rows, f = {}) {
    const q = (f.q || '').trim().toLowerCase();
    return rows.filter((r) => {
      if (f.from && r.order_date < f.from) return false;
      if (f.to && r.order_date > f.to) return false;
      for (const d of DIMENSIONS) if (f[d] && f[d] !== 'All' && r[d] !== f[d]) return false;
      if (q) {
        const hay = (r.order_id + ' ' + r.customer_name + ' ' + r.product_name + ' ' + r.country + ' ' + r.carrier).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function kpis(rows) {
    let revenue = 0, cogs = 0, ship = 0, gp = 0, units = 0, days = 0, daysN = 0, onTime = 0, otN = 0, returned = 0, cancelled = 0;
    for (const r of rows) {
      revenue += r.revenue || 0;
      cogs += r.cogs || 0;
      ship += r.shipping_cost || 0;
      gp += r.gross_profit || 0;
      units += r.quantity || 0;
      if (r.actual_days != null) { days += r.actual_days; daysN++; }
      if (r.on_time === 'Yes' || r.on_time === 'No') { otN++; if (r.on_time === 'Yes') onTime++; }
      if (r.order_status === 'Returned') returned++;
      if (r.order_status === 'Cancelled') cancelled++;
    }
    const orders = rows.length;
    return {
      orders,
      units,
      revenue,
      cogs,
      shipping_cost: ship,
      gross_profit: gp,
      margin_pct: revenue ? (gp / revenue) * 100 : 0,
      aov: orders ? revenue / orders : 0,
      on_time_pct: otN ? (onTime / otN) * 100 : 0,
      avg_delivery_days: daysN ? days / daysN : 0,
      shipping_cost_pct: revenue ? (ship / revenue) * 100 : 0,
      return_rate_pct: orders ? (returned / orders) * 100 : 0,
      cancel_rate_pct: orders ? (cancelled / orders) * 100 : 0,
    };
  }

  /** Group rows by a key and compute KPIs for each group. Returns array sorted by `sortBy` desc. */
  function groupBy(rows, key, sortBy = 'revenue') {
    const m = new Map();
    for (const r of rows) {
      const k = typeof key === 'function' ? key(r) : r[key];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    const out = [...m.entries()].map(([k, rs]) => ({ key: k, ...kpis(rs) }));
    if (sortBy) out.sort((a, b) => b[sortBy] - a[sortBy]);
    return out;
  }

  function monthly(rows) {
    return groupBy(rows, 'month', null).sort((a, b) => a.key.localeCompare(b.key));
  }

  function distinct(rows, key) {
    return [...new Set(rows.map((r) => r[key]))].sort();
  }

  /** Same-length window immediately before [from, to] — for period-over-period deltas. */
  function previousWindow(from, to) {
    const d0 = new Date(from + 'T00:00:00Z'), d1 = new Date(to + 'T00:00:00Z');
    const len = Math.round((d1 - d0) / 86400000) + 1;
    const p1 = new Date(d0.getTime() - 86400000);
    const p0 = new Date(p1.getTime() - (len - 1) * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    return { from: iso(p0), to: iso(p1) };
  }

  const fmtMoney = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  };

  /** Rule-based insight generator (works offline; the server can upgrade this with Claude). */
  function insights(rows) {
    if (!rows.length) return [];
    const out = [];
    const k = kpis(rows);
    const regions = groupBy(rows, 'region');
    const cats = groupBy(rows, 'product_category', 'margin_pct');
    const carriers = groupBy(rows, 'carrier', 'on_time_pct');
    const modes = groupBy(rows, 'ship_mode', 'shipping_cost_pct');
    const months = monthly(rows);

    out.push({ type: 'headline', title: 'Business snapshot', text: `${k.orders.toLocaleString()} orders generated ${fmtMoney(k.revenue)} revenue at a ${k.margin_pct.toFixed(1)}% gross margin, with ${k.on_time_pct.toFixed(1)}% of shipments delivered on time.` });

    if (regions.length > 1) {
      const top = regions[0];
      out.push({ type: 'growth', title: 'Revenue leader', text: `${top.key} contributes ${((top.revenue / k.revenue) * 100).toFixed(1)}% of revenue (${fmtMoney(top.revenue)}). ${regions[regions.length - 1].key} is the smallest region at ${fmtMoney(regions[regions.length - 1].revenue)}.` });
    }

    const y24 = rows.filter((r) => r.order_date < '2025-01-01'), y25 = rows.filter((r) => r.order_date >= '2025-01-01');
    if (y24.length && y25.length) {
      const g = ((kpis(y25).revenue / kpis(y24).revenue) - 1) * 100;
      out.push({ type: g >= 0 ? 'growth' : 'risk', title: 'Year-over-year', text: `Revenue ${g >= 0 ? 'grew' : 'declined'} ${Math.abs(g).toFixed(1)}% from 2024 to 2025.` });
    }

    if (carriers.length > 1) {
      const best = carriers[0], worst = carriers[carriers.length - 1];
      out.push({ type: 'risk', title: 'Carrier reliability gap', text: `${worst.key} has the lowest on-time rate (${worst.on_time_pct.toFixed(1)}%) versus ${best.key} at ${best.on_time_pct.toFixed(1)}%. Rebalancing volume toward top carriers could lift overall OTD.` });
    }

    const q4 = rows.filter((r) => ['10', '11', '12'].includes(r.order_date.slice(5, 7)));
    const rest = rows.filter((r) => !['10', '11', '12'].includes(r.order_date.slice(5, 7)));
    if (q4.length > 50 && rest.length > 50) {
      const a = kpis(q4).on_time_pct, b = kpis(rest).on_time_pct;
      if (b - a > 1) out.push({ type: 'risk', title: 'Peak-season congestion', text: `On-time delivery drops to ${a.toFixed(1)}% in Q4 versus ${b.toFixed(1)}% the rest of the year, while Q4 carries ${((kpis(q4).revenue / k.revenue) * 100).toFixed(0)}% of revenue. Pre-booking capacity before October is recommended.` });
    }

    if (modes.length > 1) {
      const m = modes[0];
      out.push({ type: 'cost', title: 'Freight cost driver', text: `${m.key} shipping costs ${m.shipping_cost_pct.toFixed(1)}% of revenue — the most expensive mode. Shifting non-urgent ${m.key.toLowerCase()} orders to Road or Rail would improve margin.` });
    }

    if (cats.length > 1) {
      out.push({ type: 'growth', title: 'Margin mix', text: `${cats[0].key} is the most profitable category (${cats[0].margin_pct.toFixed(1)}% margin); ${cats[cats.length - 1].key} is the least (${cats[cats.length - 1].margin_pct.toFixed(1)}%).` });
    }

    if (months.length >= 2) {
      const peak = [...months].sort((a, b) => b.revenue - a.revenue)[0];
      const [py, pm] = peak.key.split('-');
      const label = new Date(Date.UTC(+py, +pm - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      out.push({ type: 'headline', title: 'Peak month', text: `${label} was the strongest month with ${fmtMoney(peak.revenue)} in revenue.` });
    }

    if (k.return_rate_pct > 0) {
      out.push({ type: 'risk', title: 'Returns', text: `${k.return_rate_pct.toFixed(1)}% of orders were returned and ${k.cancel_rate_pct.toFixed(1)}% cancelled — both zero out revenue but still incur freight cost.` });
    }
    return out;
  }

  return { DIMENSIONS, hydrate, applyFilters, kpis, groupBy, monthly, distinct, previousWindow, insights, fmtMoney };
});
