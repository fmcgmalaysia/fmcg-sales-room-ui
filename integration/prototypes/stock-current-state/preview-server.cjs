'use strict';
// Local-only candidate host; exposes this preview directory, never the workspace.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, 'preview'), allowed = new Set(['index.html', 'style.css', 'app.js', 'business.js']);
http.createServer((req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
  if (!allowed.has(name)) { res.writeHead(404); res.end(); return; }
  const file = path.join(root, name), mime = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript';
  res.writeHead(200, { 'content-type': mime + '; charset=utf-8', 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res);
}).listen(8986, '127.0.0.1', () => process.stdout.write('Borrowing candidate http://127.0.0.1:8986\n'));
