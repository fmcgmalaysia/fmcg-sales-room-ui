const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const baseline = require('./finance-opening-stock-pages-base.json');

const build = '20261128-finance-opening-stock-v1';
const publicBase = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/';
const asset = 'account-room/opening-stock-20261128.js';
const changed = new Set(['account-room/index.html', 'account-room/stock-list-link.js', 'account-room/stock-list.html']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = relative => fs.readFileSync(path.join(__dirname, relative), 'utf8').replace(/\r\n/g, '\n');
const assets = directory => fs.readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(item => item.isFile()).map(item => path.relative(directory, path.join(item.parentPath, item.name)).replaceAll('\\', '/')).sort();

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'Missing or ambiguous production anchor: ' + before);
  return source.replace(before, () => after);
}

function stage(directory) {
  assert.deepEqual(assets(directory), Object.keys(baseline).sort());
  for (const [file, expected] of Object.entries(baseline)) {
    assert.equal(hash(fs.readFileSync(path.join(directory, file))), expected, file);
  }
  function edit(file, transform) {
    const target = path.join(directory, file);
    const original = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, transform(original));
  }
  edit('account-room/index.html', html => replaceOnce(html, 'stock-list-link.js?v=20261117-stock-contextual-retry-v1',
    'stock-list-link.js?v=' + build));
  edit('account-room/stock-list.html', html => {
    html = replaceOnce(html, '<button id="login" hidden>', '<button id="opening-stock" type="button" class="primary" hidden>Opening Stock</button><button id="login" hidden>');
    html = replaceOnce(html, '</head>', '<meta name="opening-stock-build" content="' + build + '"></head>');
    return replaceOnce(html, '</body>', read('opening-stock-dialog.inc.html') +
      '<script src="opening-stock-20261128.js?v=' + build + '"></script></body>');
  });
  edit('account-room/stock-list-link.js', script => {
    script = replaceOnce(script, "let frame = null, company = '', activeRequest = '', busy = false;",
      "let frame = null, company = '', activeRequest = '', busy = false, openingRequest = null;\n" +
      " const openingTypes = new Set(['ACCESS', 'PREVIEW', 'SAVE'].map(kind => 'FINANCE_OPENING_STOCK_' + kind + '_REQUEST'));");
    script = replaceOnce(script, "company = selectedCompany; activeRequest = ''; busy = false;",
      "company = selectedCompany; activeRequest = ''; busy = false; openingRequest = null;");
    script = replaceOnce(script, "stock-list.html?v=20261117-stock-contextual-retry-v1", "stock-list.html?v=" + build);
    script = replaceOnce(script, "   if (message.company !== company) return;", `   if (message.company !== company) return;
   if (message.type === 'FINANCE_OPENING_STOCK_REFRESH') {
    window.accountStockList.refresh(); return;
   }
   if (openingTypes.has(message.type)) {
    if (!/^[a-f0-9-]{36}$/i.test(message.requestId || '') || JSON.stringify(message).length > 2000) return;
    openingRequest = { id: message.requestId, type: message.type.replace('_REQUEST', '_RESULT') };
    parent.postMessage({type:message.type,company,requestId:message.requestId,input:message.input || {}},'*'); return;
   }`);
    return replaceOnce(script, "  if (event.source !== parent || !frame?.isConnected) return;", `  if (event.source !== parent || !frame?.isConnected) return;
  if (openingRequest && message.type === openingRequest.type && message.requestId === openingRequest.id && message.company === company) {
   openingRequest = null;
   frame.contentWindow.postMessage(message,targetOrigin); return;
  }`);
  });
  fs.writeFileSync(path.join(directory, asset), read('../' + asset), { flag: 'wx' });
  assert.deepEqual(assets(directory), [...Object.keys(baseline), asset].sort());
  assert.deepEqual(new Set(Object.entries(baseline).filter(([file, value]) =>
    hash(fs.readFileSync(path.join(directory, file))) !== value).map(([file]) => file)), changed);
  console.log(`${build}: 3 Finance assets patched, 1 added, ${Object.keys(baseline).length - changed.size} assets preserved.`);
}

async function fetchVerified(manifest, directory) {
  const entries = Object.entries(manifest);
  const nonce = String(Date.now());
  for (let offset = 0; offset < entries.length; offset += 8) {
    await Promise.all(entries.slice(offset, offset + 8).map(async ([file, expected]) => {
      assert.match(file, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/);
      assert.ok(!file.split('/').includes('..'));
      const url = new URL(file, publicBase);
      url.searchParams.set('openingStockVerify', nonce);
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25000) });
      assert.ok(response.ok, file + ': HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(hash(bytes), expected, file);
      if (directory) {
        const target = path.join(directory, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes, { flag: 'wx' });
      }
    }));
  }
  console.log(entries.length + ' public assets verified.');
}

async function main() {
  const [mode, target] = process.argv.slice(2);
  if (mode === 'verify-base') return fetchVerified(baseline);
  assert.ok(target, 'Provide the Pages directory.');
  const directory = path.resolve(target);
  if (mode === 'verify-release') {
    assert.deepEqual(assets(directory), [...Object.keys(baseline), asset].sort());
    return fetchVerified(Object.fromEntries(assets(directory).map(file => [file, hash(fs.readFileSync(path.join(directory, file)))])));
  }
  if (mode === 'stage-live') {
    fs.mkdirSync(directory);
    await fetchVerified(baseline, directory);
  } else assert.equal(mode, 'stage');
  stage(directory);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
