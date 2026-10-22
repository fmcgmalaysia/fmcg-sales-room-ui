'use strict';
// Mechanical narrow copies only. Original Purchase code and handlers stay intact.
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../../../purchase-live'), target = path.join(__dirname, 'purchase-ui');
const person = fs.readFileSync(path.join(__dirname, 'transfer-person.cjs'), 'utf8').replace(/\r\n/g, '\n')
  .replace(/^'use strict';\n/, '').replace('module.exports = { transferPerson, haloSvg };', 'return haloSvg;');
if (person.includes('require(') || person.includes('module.exports')) throw Error('Unexpected person runtime dependency');
const helper = '  const currentStockPerson = (() => {\n' + person + '\n})();\n';
const entries = [
  ['task-grid.js', 'source?.stockTransferOutstanding===true', '<circle cx="10" cy="5" r="4"/><path d="M2 19v-3a8 7 0 0 1 16 0v3z"/>'],
  ['supplier-allocation.js', 'saved?.stockTransferOutstanding===true', '<circle cx="10" cy="5" r="3"/><path d="M4 18v-3a6 6 0 0 1 12 0v3z"/>']
];
if (!process.argv.includes('--check')) fs.mkdirSync(target, { recursive: true });
for (const [file, condition, shape] of entries) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const svg = '<svg viewBox="0 0 20 20">' + shape + '</svg>', anchor = '(() => {\n';
  if (source.split(svg).length !== 2 || source.split(anchor).length !== 2) throw Error('Original Purchase person anchor changed');
  let candidate = source.replace(anchor, anchor + helper).replace(svg, "'+currentStockPerson(" + JSON.stringify(svg) + ',' + condition + ")+'");
  if (file === 'supplier-allocation.js') {
    const hook = 'update();renderHistory();';
    if (candidate.split(hook).length !== 2) throw Error('Original supplier relation panel anchor changed');
    const panel = '<div class="allocation-scroll">';
    if (candidate.split(panel).length !== 2) throw Error('Original supplier relation panel layout anchor changed');
    candidate = candidate.replace(panel, '<div id="allocationBorrowLinks"></div><div id="allocationBorrowApproval"></div>' + panel);
    candidate = candidate.replace(hook, hook + "window.purchaseBorrowRelations?.mount({container:document.querySelector('#allocationBorrowLinks'),workspace:workspace(),rootId:state.rootId,read:api.read,rowLabel:api.rowLabel,esc});");
    const approval = "if(!state.batchId)window.purchaseBorrowApproval?.mount({container:document.querySelector('#allocationBorrowApproval'),workspace:workspace(),rootId:state.rootId,read:api.read,rowLabel:api.rowLabel,esc,canSubmit:()=>api.stockActionReady?.()===true&&!state.running&&!state.current&&!state.dirty&&!api.savePending(),submit:input=>{if(api.stockActionReady?.()!==true||state.running||state.current||state.dirty||api.savePending())throw Error('Existing save or edits pending 请先处理原保存或修改。');api.mutate('PURCHASE_SAVE_REQUEST',{operation:'BORROW_APPROVE',input});}});";
    candidate = candidate.replace(hook, hook + approval);
  }
  // The replacement joins the original surrounding single-quoted markup string.
  // Syntax compilation checks the generated patch before it can be synchronized.
  new Function(candidate);
  const output = path.join(target, file);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(output, 'utf8').replace(/\r\n/g, '\n') !== candidate) throw Error('Purchase halo overlay differs from exact patch');
  } else fs.writeFileSync(output, candidate);
}
process.stdout.write('Purchase original-person halo overlays ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; no live edits\n');
