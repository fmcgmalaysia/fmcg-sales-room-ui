// Local synthetic examples only. No CMS access, authentication, writes or production endpoints.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const load = require('./load-master-module.cjs');
const { projectStockCard } = load('stockCardProjection.js');
const at = '2026-10-21T00:00:00Z';
const source = (id, barcode, total, customer, extra = {}) => ({ id, barcode, name: 'Example product '+barcode,
  packing: '12 × 1', ea: 12, customerId: id, ord: customer, requested: customer, po: id,
  procurement: { totalCtn: total, customerCtn: customer }, warehouse: { hasPhysicalReceipt: true, accepted: total }, ...extra });
const exception = (id, sourceTaskId) => ({ title: id, imageAltText: sourceTaskId, action: 'STOCK_EXCEPTION_REPORTED',
  result: 'SAVED', initiatedByStaffId: 'EXAMPLE', activityTime: at,
  details: { company: 'NCT', quantity: 5, kind: 'INTERNAL_DAMAGE', reason: 'Synthetic isolation example' } });
const data = projectStockCard({ company: 'NCT', tasks: [
  source('FOC-OLD', '0001', 20, 0, { specialPurchase: true, archived: true }),
  source('B-PO', '0001', 200, 200),
  source('C-PO', '0002', 220, 195),
  source('D-PO', '0003', 40, 35)
], activity: [exception('ISO-C', 'C-PO'), exception('ISO-D', 'D-PO'), {
  title: 'SETTLED-D', description: 'ISO-D', action: 'STOCK_EXCEPTION_RESOLUTION_SAVED', result: 'SAVED',
  initiatedByStaffId: 'EXAMPLE', activityTime: at,
  details: { beforeRevision: '', state: { caseId: 'ISO-D', financeApproval: { outcome: 'LOSS' } } }
}] });
const page = fs.readFileSync(path.join(__dirname, '../../warehouse-room/stock-control-preview.html'), 'utf8');
const embedded = JSON.parse(page.match(/<script id="example-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
for (const item of data.items) {
  const example = embedded.items.find(row => row.barcode === item.barcode);
  for (const key of ['onHand', 'reservedUsable', 'available', 'isolated', 'reviewRequired']) {
    if (!example || example[key] !== item[key]) throw Error('Embedded example does not match stock projection: '+item.barcode+' '+key);
  }
}
if (process.argv.includes('--check')) {
  console.log('Preview examples match the stock projection: PASS');
  process.exit(0);
}
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if(req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if(req.url === '/candidate-data') { res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.end(JSON.stringify(data)); }
  if(req.url === '/' || req.url === '/stock-control-preview.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(page); }
  res.writeHead(404); res.end();
});
server.listen(8951, '127.0.0.1', () => console.log('Synthetic Stock Control preview: http://127.0.0.1:8951/'));
