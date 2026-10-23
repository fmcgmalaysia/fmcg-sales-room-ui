'use strict';
const fs=require('node:fs'),path=require('node:path');
let source=fs.readFileSync(path.join(__dirname,'../../backend/purchaseProjection.js'),'utf8').replace(/\r\n/g,'\n');
function once(before,after){if(source.split(before).length!==2)throw Error('Original Purchase projection anchor changed');source=source.replace(before,()=>after);}
const helper=`export const PURCHASE_CURRENT_PROJECTION_VERSION = 2;
const verifiedBatchAllocation=${require('./purchase-batch-allocation.cjs').batchAllocation.toString()};
function verifiedCurrentPurchaseProjection(view,company){
  if(view===undefined)return null;
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  if(view?.schema!=='PURCHASE_CURRENT_PROJECTION_V2'||view.company!==company||!count(view.generation)
    ||!Array.isArray(view.taskReceived)||!Array.isArray(view.sourceAvailable)||!Array.isArray(view.allocations))throw Error('Verified current Purchase projection required');
  for(const rows of [view.taskReceived,view.sourceAvailable])if(new Set(rows.map(row=>row.taskId)).size!==rows.length
    ||rows.some(row=>typeof row?.taskId!=='string'||!row.taskId))throw Error('Unique current Purchase projection identities required');
  if(view.taskReceived.some(row=>!count(row.quantity))||view.sourceAvailable.some(row=>!count(row.accepted)||!count(row.availableCtn)
    ||!count(row.availablePhysical)||row.availableCtn>row.availablePhysical||row.availablePhysical>row.accepted)
    ||new Set(view.allocations.map(row=>row.sourceTaskId)).size!==view.allocations.length
    ||view.allocations.some(row=>!row.sourceTaskId||!Array.isArray(row.targets)||new Set(row.targets.map(target=>target.taskId)).size!==row.targets.length
      ||row.targets.some(target=>!target.taskId||!count(target.quantity))))throw Error('Known current Purchase projection quantities required');
  return view;
}
`;
// Additional display facts are optional for retained old snapshots, never guessed.
// An absent fact block cannot enable an "available stock" action.
const factsGuard=`  for(const row of view.taskReceived)if(row.allocationFacts!==undefined){
    const f=row.allocationFacts;
    if(!f||!['usable','held','dispatched','availableToArrange'].every(k=>count(f[k]))
      ||typeof f.review!=='boolean'||f.availableToArrange!==(f.review?0:Math.max(0,f.usable-f.held))
      ||f.usable+f.dispatched!==row.quantity)throw Error('Current allocation availability requires review');
  }
`;
once('export function projectPurchaseWorkspace({ company, orders, tasks, activity, suppliers, staff }) {',
  helper+'export function projectPurchaseWorkspace({ company, orders, tasks, activity, suppliers, staff, currentStock }) {');
once('  const accepted = new Map();','  const current=verifiedCurrentPurchaseProjection(currentStock,company);\n  const accepted = new Map();');
once('  return view;\n}',factsGuard+'  return view;\n}');
once('allocations=readAllocations(activity);','allocations=current?current.allocations:readAllocations(activity);');
const anchor='  for (const receipt of accepted.values()) if ([...receipt.ids].some(id => !seen.has(id)))';
once(anchor,`  // Original shortage/receipt facts above stay unchanged. Current ownership must
  // precede ORIGINAL split entitlements and batch-stock/version calculations below.
  if(current){
    for(const entry of current.taskReceived){const row=rows.find(row=>row.id===entry.taskId&&!row.procurementSource&&!row.specialPurchase);
      if(!row)throw Error('Current Purchase demand identity missing');row.inc=entry.quantity;row.stockAllocatedCumulative=entry.quantity;
      if(entry.allocationFacts)row.stockAllocationFacts={...entry.allocationFacts};}
    for(const entry of current.sourceAvailable){const row=rows.find(row=>row.id===entry.taskId);
      if(!row||!row.po||(row.warehouse?.hasPhysicalReceipt===true?row.warehouse.accepted:0)!==entry.accepted)throw Error('Current Purchase receipt provenance differs');
      row.procurement.availableCtn=entry.availableCtn;row.procurement.allocationEnabled=entry.availableCtn>0;
      if(row.warehouse)row.warehouse={...row.warehouse,stock:{...row.warehouse.stock,availablePhysical:entry.availablePhysical}};
    }
  }
`+anchor);
once('    company, staff: { staffId:',"    ...(current?{stockAllocationView:'CURRENT_V2'}:{}),\n    company, staff: { staffId:");
once('  return {\n    ...(current?',`  if(current)for(const row of rows.filter(row=>!row.procurementSource&&!row.specialPurchase)){
    const amounts=verifiedBatchAllocation(row);if(amounts)row.stockAllocatedBatches=amounts;
  }
  return {
    ...(current?`);
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
const target=path.join(__dirname,'purchaseProjection.candidate.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Purchase current projector differs');}
else fs.writeFileSync(target,source);
process.stdout.write('Original Purchase current projection seam '+(process.argv.includes('--check')?'verified':'built')+'; no production edit\n');
