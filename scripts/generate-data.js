#!/usr/bin/env node
/**
 * Generates a realistic, reproducible Supply Chain & Logistics sales dataset.
 * Output:
 *   data/supply_chain_sales.csv        -> flat fact table (used by Power BI + web portal)
 *   public/data/orders.json            -> same data for the static web portal / GitHub Pages
 *
 * Usage: node scripts/generate-data.js [rows]   (default 6000)
 */
const fs = require('fs');
const path = require('path');

const ROWS = parseInt(process.argv[2] || '6000', 10);

// ---- Seeded RNG so the dataset is identical on every run ----
let seed = 20261003;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function weighted(items) {
  const total = items.reduce((s, i) => s + i.w, 0);
  let r = rand() * total;
  for (const i of items) { if ((r -= i.w) <= 0) return i; }
  return items[items.length - 1];
}
const round2 = (n) => Math.round(n * 100) / 100;
const gauss = () => (rand() + rand() + rand() + rand() - 2) / 2; // ~N(0, ~0.58)

// ---- Master data ----
const REGIONS = [
  { name: 'North America', w: 34, countries: ['United States', 'Canada', 'Mexico'], warehouses: ['Dallas DC', 'Chicago DC'] },
  { name: 'Europe', w: 26, countries: ['Germany', 'United Kingdom', 'France', 'Netherlands'], warehouses: ['Rotterdam Hub'] },
  { name: 'Asia Pacific', w: 22, countries: ['India', 'Singapore', 'Japan', 'Australia'], warehouses: ['Singapore Hub'] },
  { name: 'Latin America', w: 10, countries: ['Brazil', 'Chile', 'Colombia'], warehouses: ['São Paulo DC'] },
  { name: 'Middle East & Africa', w: 8, countries: ['UAE', 'Saudi Arabia', 'South Africa'], warehouses: ['Dubai Hub'] },
];

const CATEGORIES = [
  { name: 'Electronics', w: 24, margin: 0.28, products: [['Industrial Sensor Kit', 185], ['RFID Tag Pack (500)', 240], ['Barcode Scanner Pro', 320], ['IoT Gateway', 410], ['Rugged Tablet', 690]] },
  { name: 'Industrial Parts', w: 20, margin: 0.33, products: [['Ball Bearing Set', 48], ['Hydraulic Pump', 520], ['Conveyor Belt Segment', 260], ['Steel Fastener Box', 35], ['Gear Motor', 380]] },
  { name: 'Packaging', w: 16, margin: 0.22, products: [['Corrugated Boxes (100)', 62], ['Stretch Wrap Roll', 28], ['Pallet (Heat-Treated)', 24], ['Bubble Wrap Bulk', 45], ['Shipping Labels (5k)', 55]] },
  { name: 'Pharma Supplies', w: 14, margin: 0.38, products: [['Cold-Chain Container', 450], ['Sterile Gloves Case', 85], ['Temperature Logger', 140], ['Vaccine Carrier', 310]] },
  { name: 'Consumer Goods', w: 16, margin: 0.25, products: [['Smart Home Bundle', 210], ['Kitchen Appliance Set', 160], ['Fitness Tracker', 95], ['Bluetooth Speaker', 70]] },
  { name: 'Automotive Parts', w: 10, margin: 0.30, products: [['Brake Pad Set', 75], ['EV Charging Cable', 230], ['Alternator', 290], ['LED Headlight Kit', 120]] },
];

const SEGMENTS = [
  { name: 'Retail', w: 30, disc: 0.04 },
  { name: 'Wholesale', w: 25, disc: 0.10 },
  { name: 'E-commerce', w: 28, disc: 0.06 },
  { name: 'Distributor', w: 17, disc: 0.14 },
];

const CUSTOMERS = {
  Retail: ['Northwind Stores', 'BrightMart', 'UrbanCart', 'Maple Retail Co', 'Harbor Outfitters'],
  Wholesale: ['Prime Wholesale', 'Granite Supply', 'BulkWorks Ltd', 'Summit Traders'],
  'E-commerce': ['ShopSphere', 'ClickBasket', 'Parcelly', 'NovaMarket Online', 'CartNest'],
  Distributor: ['Global Distrib Inc', 'Pioneer Logistics Partners', 'Atlas Channel Group'],
};

const SHIP_MODES = [
  { name: 'Road', w: 42, days: 4, costPct: 0.045, otd: 0.92 },
  { name: 'Ocean', w: 22, days: 24, costPct: 0.030, otd: 0.78 },
  { name: 'Air', w: 20, days: 2, costPct: 0.110, otd: 0.95 },
  { name: 'Rail', w: 16, days: 8, costPct: 0.038, otd: 0.86 },
];

// Fictional carriers with distinct reliability profiles
const CARRIERS = [
  { name: 'Atlas Freight', reliability: 0.04 },
  { name: 'BlueLine Logistics', reliability: 0.02 },
  { name: 'Meridian Express', reliability: 0.06 },
  { name: 'Coastal Shipping Co', reliability: -0.06 },
  { name: 'SkyBridge Cargo', reliability: -0.01 },
];

// Seasonality: Q4 peak, summer slump
const MONTH_FACTOR = [0.85, 0.82, 0.95, 0.98, 1.0, 0.92, 0.88, 0.95, 1.02, 1.1, 1.28, 1.35];

const START = new Date(Date.UTC(2024, 0, 1));
const END = new Date(Date.UTC(2025, 11, 31));
const DAY = 86400000;

function randomOrderDate() {
  // rejection sampling to apply seasonality + 18% YoY growth
  while (true) {
    const t = START.getTime() + rand() * (END.getTime() - START.getTime());
    const d = new Date(t);
    const growth = d.getUTCFullYear() === 2025 ? 1.18 : 1.0;
    const f = (MONTH_FACTOR[d.getUTCMonth()] * growth) / (1.35 * 1.18);
    if (rand() < f) return new Date(Math.floor(t / DAY) * DAY);
  }
}
const iso = (d) => d.toISOString().slice(0, 10);

const rows = [];
for (let i = 0; i < ROWS; i++) {
  const region = weighted(REGIONS);
  const country = pick(region.countries);
  const warehouse = pick(region.warehouses);
  const cat = weighted(CATEGORIES);
  const [product, basePrice] = pick(cat.products);
  const seg = weighted(SEGMENTS);
  const customer = pick(CUSTOMERS[seg.name]);
  // Pharma ships air more often; packaging/industrial go by road/ocean
  let modes = SHIP_MODES.map((m) => ({ ...m }));
  if (cat.name === 'Pharma Supplies') modes.find((m) => m.name === 'Air').w *= 2.5;
  if (cat.name === 'Packaging') modes.find((m) => m.name === 'Ocean').w *= 1.8;
  const mode = weighted(modes);
  const carrier = pick(CARRIERS);

  const orderDate = randomOrderDate();
  const qtyBase = seg.name === 'Distributor' || seg.name === 'Wholesale' ? 40 : 12;
  const quantity = Math.max(1, Math.round(qtyBase * (0.4 + rand() * 1.6)));
  const unitPrice = round2(basePrice * (0.92 + rand() * 0.16));
  const discount = round2(Math.min(0.3, Math.max(0, seg.disc + gauss() * 0.04)));
  const revenue = round2(quantity * unitPrice * (1 - discount));
  const cogs = round2(revenue * (1 - cat.margin - gauss() * 0.04) * (1 + discount * 0.6));
  const shippingCost = round2(revenue * mode.costPct * (0.8 + rand() * 0.5));

  const processingDays = 1 + Math.floor(rand() * 3);
  const shipDate = new Date(orderDate.getTime() + processingDays * DAY);
  const promisedDays = mode.days + processingDays + 1;

  // On-time probability: mode base + carrier reliability + Q4 congestion penalty
  const q4 = orderDate.getUTCMonth() >= 10 ? -0.07 : 0;
  const onTimeProb = Math.min(0.99, Math.max(0.4, mode.otd + carrier.reliability + q4));
  const onTime = rand() < onTimeProb;
  const delay = onTime ? -Math.floor(rand() * 2) : 1 + Math.floor(rand() * (mode.days / 3 + 3));
  const actualDays = Math.max(1, promisedDays + delay);
  const deliveryDate = new Date(orderDate.getTime() + actualDays * DAY);

  // Status: recent orders may still be in transit
  let status = 'Delivered';
  if (deliveryDate > END) status = 'In Transit';
  const r = rand();
  if (status === 'Delivered' && r < 0.035) status = 'Returned';
  else if (status === 'Delivered' && r < 0.05) status = 'Cancelled';

  const netRevenue = status === 'Cancelled' || status === 'Returned' ? 0 : revenue;
  const netCogs = status === 'Cancelled' ? 0 : cogs;
  const grossProfit = round2(netRevenue - netCogs - shippingCost);

  rows.push({
    order_id: 'SO-' + String(100000 + i),
    order_date: iso(orderDate),
    ship_date: iso(shipDate),
    delivery_date: status === 'In Transit' ? '' : iso(deliveryDate),
    region: region.name,
    country,
    warehouse,
    customer_segment: seg.name,
    customer_name: customer,
    product_category: cat.name,
    product_name: product,
    ship_mode: mode.name,
    carrier: carrier.name,
    quantity,
    unit_price: unitPrice,
    discount,
    revenue: netRevenue,
    cogs: netCogs,
    shipping_cost: shippingCost,
    gross_profit: grossProfit,
    promised_days: promisedDays,
    actual_days: status === 'In Transit' ? '' : actualDays,
    on_time: status === 'In Transit' || status === 'Cancelled' ? '' : onTime ? 'Yes' : 'No',
    order_status: status,
  });
}
rows.sort((a, b) => a.order_date.localeCompare(b.order_date) || a.order_id.localeCompare(b.order_id));
rows.forEach((r, i) => { r.order_id = 'SO-' + String(100001 + i); }); // chronological order IDs

const root = path.join(__dirname, '..');
const headers = Object.keys(rows[0]);
const esc = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v);
const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
fs.writeFileSync(path.join(root, 'data', 'supply_chain_sales.csv'), csv + '\n');

// Compact columnar JSON for the browser
const json = { columns: headers, rows: rows.map((r) => headers.map((h) => r[h])) };
fs.writeFileSync(path.join(root, 'public', 'data', 'orders.json'), JSON.stringify(json));

console.log(`Generated ${rows.length} orders -> data/supply_chain_sales.csv & public/data/orders.json`);
