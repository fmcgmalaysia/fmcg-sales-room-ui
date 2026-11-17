const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createIsolation } = require('./isolation.cjs');

function start({ port = 8896, file = path.join(__dirname, '.qa-state.json') } = {}) {
  const qa = createIsolation({ file });
  let recoveryBusy = false;
  const timer = setInterval(async () => {
    if (recoveryBusy) return;
    recoveryBusy = true;
    try { await qa.service.recover(); } finally { recoveryBusy = false; }
  }, 1500);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:' + port) throw Error('Origin rejected');
      if (url.pathname.startsWith('/api/')) {
        const customerId = url.searchParams.get('customer') || 'QA-A';
        const actor = qa.actors[url.searchParams.get('actor') || 'sales'];
        if (!actor) throw Error('Choose a QA identity');
        let body = {};
        if (req.method === 'POST') {
          let raw = '';
          for await (const chunk of req) { raw += chunk; if (raw.length > 50000) throw Error('Request too large'); }
          body = JSON.parse(raw || '{}');
        }
        const buyer = qa.buyerApi(customerId);
        let result;
        if (req.method === 'GET' && url.pathname === '/api/catalogue') {
          result = { customer: { ...qa.customers().find(item => item.customerId === customerId) }, products: qa.products(), selected: await buyer.getCatalogueSelectionState() };
          delete result.customer.rateToMyr;
        } else if (req.method === 'GET' && url.pathname === '/api/quotes') result = qa.service.list(actor, customerId);
        else if (req.method === 'GET' && url.pathname === '/api/buyer') result = await buyer.getBuyerWorkspace();
        else if (req.method === 'GET' && url.pathname === '/api/excel') {
          const exported = await qa.exportExcel(customerId);
          res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="QA-My-Selection.xlsx"' });
          return res.end(exported.bytes);
        } else if (req.method === 'POST' && url.pathname === '/api/select') result = await buyer.addCatalogueSelection(body.productId);
        else if (req.method === 'POST' && url.pathname === '/api/cost') result = await qa.service.catchCost(actor, customerId);
        else if (req.method === 'POST' && url.pathname === '/api/draft') result = await qa.service.saveDraft(actor, customerId, body.selectionId, body.input, body.revision, body.requestId);
        else if (req.method === 'POST' && url.pathname === '/api/publish') result = await qa.service.publish(actor, customerId, body.selectionId, body.enabled, body.revision, body.requestId);
        else if (req.method === 'POST' && url.pathname === '/api/order') result = await buyer.submitBuyerOrder(body.lines, '', body.requestId, 'QA-WEB-QUOTE');
        else { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const fileInfo = files[url.pathname];
      if (!fileInfo) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': fileInfo[1] + '; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, fileInfo[0])));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
  server.on('close', () => clearInterval(timer));
  server.listen(port, '127.0.0.1');
  return { server, qa };
}
if (require.main === module) {
  start();
  console.log('Isolated quotation preview http://127.0.0.1:8896');
}
module.exports = { start };
