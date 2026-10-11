#!/usr/bin/env node
/**
 * Splits data/supply_chain_sales.csv into a star schema for Power BI:
 *   powerbi/data/FactSales.csv, DimDate.csv, DimProduct.csv, DimCustomer.csv,
 *   DimGeography.csv, DimCarrier.csv
 * Usage: node scripts/build-powerbi-tables.js
 */
const fs = require('fs');
const path = require('path');
const A = require('../public/js/analytics.js');

const root = path.join(__dirname, '..');
const rows = A.hydrate(JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'orders.json'), 'utf8')));
const out = path.join(root, 'powerbi', 'data');
fs.mkdirSync(out, { recursive: true });

const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
function write(name, objs) {
  const cols = Object.keys(objs[0]);
  fs.writeFileSync(path.join(out, name), [cols.join(','), ...objs.map((o) => cols.map((c) => esc(o[c])).join(','))].join('\n') + '\n');
  console.log(`${name.padEnd(18)} ${objs.length} rows`);
}
function dim(keyName, fields, keyFn) {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!m.has(k)) { const o = { [keyName]: m.size + 1 }; fields.forEach((f) => (o[f] = r[f])); m.set(k, o); }
  });
  return m;
}

const product = dim('ProductKey', ['product_name', 'product_category'], (r) => r.product_name);
const customer = dim('CustomerKey', ['customer_name', 'customer_segment'], (r) => r.customer_name);
const geo = dim('GeographyKey', ['country', 'region', 'warehouse'], (r) => r.country + '|' + r.warehouse);
const carrier = dim('CarrierKey', ['carrier', 'ship_mode'], (r) => r.carrier + '|' + r.ship_mode);

write('FactSales.csv', rows.map((r) => ({
  order_id: r.order_id, order_date: r.order_date, ship_date: r.ship_date, delivery_date: r.delivery_date,
  ProductKey: product.get(r.product_name).ProductKey,
  CustomerKey: customer.get(r.customer_name).CustomerKey,
  GeographyKey: geo.get(r.country + '|' + r.warehouse).GeographyKey,
  CarrierKey: carrier.get(r.carrier + '|' + r.ship_mode).CarrierKey,
  quantity: r.quantity, unit_price: r.unit_price, discount: r.discount, revenue: r.revenue, cogs: r.cogs,
  shipping_cost: r.shipping_cost, gross_profit: r.gross_profit, promised_days: r.promised_days, actual_days: r.actual_days,
  on_time: r.on_time, order_status: r.order_status,
})));
write('DimProduct.csv', [...product.values()]);
write('DimCustomer.csv', [...customer.values()]);
write('DimGeography.csv', [...geo.values()]);
write('DimCarrier.csv', [...carrier.values()]);

// Date dimension
const dates = [];
for (let d = new Date(Date.UTC(2024, 0, 1)); d <= new Date(Date.UTC(2025, 11, 31)); d = new Date(d.getTime() + 86400000)) {
  const m = d.getUTCMonth();
  dates.push({
    Date: d.toISOString().slice(0, 10), Year: d.getUTCFullYear(), Quarter: 'Q' + (Math.floor(m / 3) + 1), MonthNumber: m + 1,
    Month: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), YearMonth: d.toISOString().slice(0, 7),
    Weekday: d.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' }), IsPeakSeason: m >= 9 ? 'Yes' : 'No',
  });
}
write('DimDate.csv', dates);
