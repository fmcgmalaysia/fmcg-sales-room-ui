'use strict';
// Preserve original display identities/reconciliation and old accepted receipts.
// New current saves use an immutable business event, not protocol-reserved root IDs.
const fs = require('node:fs'), path = require('node:path');
let source = fs.readFileSync(path.join(__dirname, '../../backend/purchaseDisplayOrder.js'), 'utf8').replace(/\r\n/g, '\n');
const anchor = " const saved=activity.filter(row=>{const plan=row.details?.plan,done=completed.get(operationId(row.title,'RESULT'));return row.action==='PURCHASE_OPERATION_PREPARED'&&plan?.displayOrder&&done?.details?.outcome?.ok===true&&done.details.outcome.company===company&&done.details.outcome.requestId===row.details.requestId;});";
if (source.split(anchor).length !== 2) throw Error('Original Purchase display receipt anchor changed');
const seam = `
 const current=activity.filter(row=>row.action==='PURCHASE_DISPLAY_ORDER_SAVED').flatMap(row=>{
  if(row.company!==company||row._id!==row.title||!row._id||row.result!=='SAVED'||row.details?.schema!==2
    ||!row.initiatedByStaffId||!Number.isFinite(Date.parse(row.activityTime)))throw Error('Current Purchase row order receipt requires review.');
  const order=row.details.displayOrder;if(order===null)return [];
  if(!order||typeof order.customerId!=='string'||!order.customerId||typeof order.beforeRevision!=='string'||typeof order.beforeVersion!=='string'
    ||!Array.isArray(order.rows)||new Set(order.rows).size!==order.rows.length||order.rows.some(key=>typeof key!=='string'))throw Error('Current Purchase display identity requires review.');
  return [{...row,details:{...row.details,plan:{displayOrder:order}}}];
 });
 saved.push(...current);`;
source = source.replace(anchor, anchor + seam) + '\nexport const PURCHASE_CURRENT_DISPLAY_ORDER_VERSION = 2;\n';
const target = path.join(__dirname, 'purchaseDisplayOrder.candidate.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Purchase display order candidate differs');
} else fs.writeFileSync(target, source);
process.stdout.write('Original Purchase display receipt candidate '+(process.argv.includes('--check') ? 'verified' : 'built')+'; no live edits\n');
