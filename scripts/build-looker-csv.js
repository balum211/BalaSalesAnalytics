#!/usr/bin/env node
/**
 * Builds data/looker_sales.csv: a Looker Studio–friendly copy of the dataset with readable column
 * names and numeric flags, so averages like On-Time % need no calculated fields.
 *   On-Time Flag:   1 = on time, 0 = late, blank = not delivered (AVG = on-time rate)
 *   Late Flag:      1 = delivered late, else 0 (SUM = late shipments)
 *   Delivered Flag: 1 = delivered (Yes/No on_time), else 0
 * Usage: node scripts/build-looker-csv.js
 */
const fs = require('fs'), path = require('path');
const A = require('../public/js/analytics.js');
const root = path.join(__dirname, '..');
const rows = A.hydrate(JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'orders.json'), 'utf8')));
const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
const out = rows.map((r) => {
  const m = +r.order_date.slice(5, 7);
  return {
    'Order ID': r.order_id, 'Order Date': r.order_date, 'Year': r.order_date.slice(0, 4), 'Quarter': `Q${Math.floor((m - 1) / 3) + 1}`,
    'Region': r.region, 'Country': r.country, 'Warehouse': r.warehouse, 'Customer Segment': r.customer_segment, 'Customer': r.customer_name,
    'Product Category': r.product_category, 'Product': r.product_name, 'Ship Mode': r.ship_mode, 'Carrier': r.carrier, 'Order Status': r.order_status,
    'Quantity': r.quantity, 'Revenue': r.revenue, 'COGS': r.cogs, 'Freight Cost': r.shipping_cost, 'Gross Profit': r.gross_profit,
    'Promised Days': r.promised_days, 'Delivery Days': r.actual_days == null ? '' : r.actual_days,
    'On-Time Flag': r.on_time === 'Yes' ? 1 : r.on_time === 'No' ? 0 : '', 'Late Flag': r.on_time === 'No' ? 1 : 0, 'Delivered Flag': r.on_time ? 1 : 0,
  };
});
const cols = Object.keys(out[0]);
fs.writeFileSync(path.join(root, 'data', 'looker_sales.csv'), [cols.join(','), ...out.map((o) => cols.map((c) => esc(o[c])).join(','))].join('\n') + '\n');
console.log(`data/looker_sales.csv: ${out.length} rows, ${cols.length} columns`);
