// Runs a batch of natural-language questions through the built-in analyst.  node scripts/chat-test.js
const fs = require('fs'), path = require('path');
const A = require('../public/js/analytics.js'), C = require('../public/js/chat-engine.js');
const rows = A.hydrate(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'orders.json'), 'utf8')));
const Q = process.argv.slice(2).length ? process.argv.slice(2) : [
  'What was total revenue in 2025?', 'Top 5 products by revenue', 'Which carrier has the worst on-time delivery?',
  'Compare Europe vs Asia Pacific profit', 'Monthly revenue trend in 2025', 'How did revenue grow from 2024 to 2025?',
  'Freight % of revenue by ship mode', 'Which region grew fastest?', 'Average delivery time for Ocean shipments',
  'Top customers by margin in Q4 2025', 'how many orders did BulkWorks Ltd place', 'which warehouse is slowest',
  'best carrier', 'revenue by category in Europe', 'return rate by segment', 'profit in March 2025',
  'what is the margin for pharma', 'late shipments by carrier in Q4 2024', 'quarterly profit', 'Air vs Ocean freight cost',
  'which country has the most sales', 'on time % this year vs last year', 'hello', 'revenue in 2030',
];
for (const q of Q) {
  const a = C.answer(rows, q);
  console.log('\nQ: ' + q + '\nA: ' + a.text.replace(/\*\*/g, ''));
  if (a.table) console.log('   [' + a.table.columns.join(' | ') + '] ' + a.table.rows.slice(0, 3).map((r) => r.join(' | ')).join(' ; '));
}
