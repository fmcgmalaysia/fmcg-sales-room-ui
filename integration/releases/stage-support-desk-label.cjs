const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { compactHeader, compactOverview, compactTransactions, chargeInvoiceForm, css } = require('./support-compact-document-header.cjs');

const build = '20261113-support-workroom-compact-v1';
const previousBuild = '20261111-support-split-quantity-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originals = {
  'workroom.js': 'd2bf9566dbfa4ebf9995a95794dc8bb83f3b1f7747d73c04b1dcf48c3158a63c',
  'workroom.css': 'a21ac4a18f1cba4aad9ea28a8c3359558c21b4f6b964695af7d6f4e1de9580fe',
  'workroom.html': '28d868d71e6c0bc35c31a9fe2ca28d792a156629470d62aef4470635fbc57b8d',
};

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, () => after);
}

function patchScript(source) {
  source = replaceOnce(source, '  function orderContent(order){', `  function splitDeskLabel(line){
    const desk=line.portionDesk??(currentDeskInvoice()?activeDesk:null);
    const portions=Number.isSafeInteger(desk)
      ? [{desk,quantity:line.orderQty}]
      : (line.deskPortions||[]).map(part=>({desk:part.desk,quantity:part.quantity-(part.invoiced||0)}));
    return portions.filter(part=>part.quantity>0).sort((a,b)=>(a.desk||4)-(b.desk||4)).map(part=>
      '<span class="desk-portion'+(part.desk?'':' desk-portion-pending')+'">'+
      (part.desk?'Desk '+part.desk:'Pending')+' · '+number(part.quantity)+'</span>').join('')||'—';
  }

  function orderContent(order){`);
  source = replaceOnce(source, "unassignedRemainder=line.deskPortions?.some(part=>part.desk===0&&part.quantity>0)&&!line.deskPortions.some(part=>part.desk>0&&part.quantity>(part.invoiced||0)),", '');
  source = replaceOnce(source, "class=\"'+(unassignedRemainder?'unassigned':'')+'\"", 'class="desk-portions"');
  source = replaceOnce(source, "aria-label=\"'+(unassignedRemainder?'Arrange Desk 待安排':'Split shipment 分批出货')+'\"", 'title="Manage split shipment 分批出货"');
  return replaceOnce(source, "+(unassignedRemainder?'—':'Split…')+", '+splitDeskLabel(line)+');
}

function stageSupportDeskLabel(site) {
  const directory = path.join(site, 'support-room');
  const sources = Object.fromEntries(Object.entries(originals).map(([name, sha]) => {
    const bytes = fs.readFileSync(path.join(directory, name));
    assert.equal(hash(bytes), sha, name);
    return [name, bytes.toString('utf8')];
  }));
  sources['workroom.js'] = chargeInvoiceForm(compactTransactions(compactOverview(compactHeader(patchScript(sources['workroom.js'])))));
  sources['workroom.css'] += `
.desk-cell .desk-portions{display:inline-grid;gap:3px;text-align:left;padding:3px 5px}
.desk-portion{white-space:nowrap;font-size:11px;line-height:14px}
.desk-portion-pending{color:#fff;background:#f58a00;border-radius:4px;padding:0 3px}
.desk-portions:disabled .desk-portion-pending{color:#875000;background:#fff0d6}
`;
  sources['workroom.css'] += css + '\n';
  sources['workroom.html'] = sources['workroom.html'].replaceAll(previousBuild, build)
    .replace('data-view="transactions">Transactions</button>', 'data-view="transactions">Invoices &amp; Payments</button>');
  for (const [name, content] of Object.entries(sources)) fs.writeFileSync(path.join(directory, name), content);
}

module.exports = { build, patchScript, stageSupportDeskLabel };
if (require.main === module) stageSupportDeskLabel(process.argv[2]);
