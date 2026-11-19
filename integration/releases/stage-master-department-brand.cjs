const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const approved = new Map([
  ['purchase-live/index.html', '79ca214a9912d9b086c88f820daf1b185a3d023914c36bd7c2c838c64c1b5d24'],
  ['support-room/workroom.html', 'd7ee40aa39c194723c592051570bf2f531f4be24a91f22a56f4f3298c7b11963'],
  ['warehouse-room/index.html', '7d6e66989b3eb0baba006b7710041a5ba646a70e9a082f20ad78f1980e0fc849'],
  ['warehouse-room/stock-control.html', '0ddf5cae50bb3819d0722aa7f44cd6d917733602943f412308d09efa4eec35bf'],
  ['account-room/index.html', 'b1063f59fd593b153d430ad90d1346819c4b4a8e84b58c29e0f9da3cae421baf'],
  ['account-room/stock-list.html', '6b7df1e2ea9a40ad2d1c253677e89e64234b2a0f2ede69e76547266d96580dce'],
  ['master-staff/index.html', '54894c3830e09813ac8611c077c05933ef2722e0b903fd6a12485efa119a89d7'],
  ['master-quotations/index.html', '0176e70121f362541b0070f204e7c4f7ce286da1730d32f06b0be400b8e96719']
]);

const mark = '<img data-ltpos-brand-mark src="https://static.wixstatic.com/media/4ecd18_e1d405185f9a4efdbb867f139f234848~mv2.png" width="192" height="192" alt="" style="width:1.27em;height:.83em;object-fit:cover;vertical-align:-.095em;margin-inline-end:.35em">';

function brandHeader(html, entry) {
  const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0];
  if (!header || header.split('>MASTER</strong>').length !== 2) {
    throw new Error(`Unrecognized department header in ${entry}`);
  }
  const branded = header.replace('>MASTER</strong>', `>${mark}MASTER</strong>`)
    .replace(/ <small(?: lang="zh-CN")?>(?:采购部|货仓部)<\/small>/g, '')
    .replace('Administration 管理', 'Administration')
    .replaceAll('Company 公司', 'Company')
    .replace('正在确认员工身份…', 'Verifying staff…')
    .replace('Connecting 正在连接', 'Connecting…');
  if (/[\u3400-\u9fff]/u.test(branded)) throw new Error(`Unexpected Chinese header text in ${entry}`);
  const updated = html.replace(header, () => branded);
  if (entry !== 'warehouse-room/stock-control.html') return updated;
  return updated.replace('<b>Stock List 库存清单</b>', '<b>Stock List</b>')
    .replace('<h1>Stock List 库存清单</h1>', '<h1>Stock List</h1>');
}

function stage(root) {
  const pending = [];
  for (const [entry, expected] of approved) {
    const destination = path.join(root, entry);
    const source = fs.readFileSync(destination);
    const actual = createHash('sha256').update(source).digest('hex');
    if (actual !== expected) throw new Error(`Baseline differs for ${entry}: ${actual}`);
    pending.push([destination, brandHeader(source.toString('utf8'), entry)]);
  }
  for (const [destination, rewritten] of pending) fs.writeFileSync(destination, rewritten, 'utf8');
  console.log(`Updated ${pending.length} verified HTML resources.`);
}

if (require.main === module) {
  if (!process.argv[2]) throw new Error('Pass the extracted Pages release directory.');
  stage(process.argv[2]);
}

module.exports = { brandHeader };
