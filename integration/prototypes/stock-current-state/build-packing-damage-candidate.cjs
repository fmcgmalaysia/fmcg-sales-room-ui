'use strict';
// Reviewed current-stock extension of the ORIGINAL list model. Legacy contexts
// keep their exact checks. Does not edit/install the protected production files.
const fs=require('node:fs'),path=require('node:path');
let source=fs.readFileSync(path.join(__dirname,'../../backend/packingListModel.js'),'utf8').replace(/\r\n/g,'\n');
function once(before,after){if(source.split(before).length!==2)throw Error('Original packing damage anchor changed: '+before.slice(0,60));source=source.replace(before,()=>after);}
once('function checkExecuted(lines){',`export const PACKING_CURRENT_DAMAGE_VERSION=1;
function checkDamageSupply(list,context,physical=false){
 if(context.stockDamageVersion!==1)return checkSupply(list,context);
 const available=packingAvailability(context,list.id);
 for(const line of list.lines){const task=available.find(task=>task.taskId===line.taskId),isolated=task?.stockDamageIsolation||0;
  if(!task||task.review||task.company!==list.company||task.customerId!==list.customerId||task.currency!==list.currency
   ||!quantity(isolated)||line.quantity>task.readyToArrange+isolated||physical&&Math.max(line.packed,line.loaded)>task.readyToArrange)fail('Isolated stock cannot be packed or loaded. Correct physical quantities and explain the shortage.');
 }
}
function checkExecuted(lines){`);
once("if(next.status!=='SENT')fail('Only a sent list can be started.');checkSupply(next,context);next.status='PROCESSING';", "if(next.status!=='SENT')fail('Only a sent list can be started.');checkDamageSupply(next,context);next.status='PROCESSING';");
once("if(next.status!=='PROCESSING')fail('Start Warehouse processing first.');\n  checkSupply(next,context);", "if(next.status!=='PROCESSING')fail('Start Warehouse processing first.');\n  if(context.stockDamageVersion!==1)checkSupply(next,context);");
once('  // A proposed change keeps old quantities until Warehouse acknowledges it.', `  if(context.stockDamageVersion===1)checkDamageSupply(next,context,true);
  if(next.stockDamageReviewRequired===true){
   if(context.stockDamageVersion!==1||!Array.isArray(next.stockDamageCases)||!next.stockDamageCases.length||next.stockDamageCases.some(item=>!item?.caseId||!next.lines.some(line=>line.taskId===item.taskId&&reason(input.lines.find(update=>update.taskId===item.taskId)?.reason))))fail('Explain the physical damage recheck for every affected product.');
   next.stockDamageReview={cases:copy(next.stockDamageCases),at};next.stockDamageCases=[];next.stockDamageReviewRequired=false;
  }
  // A proposed change keeps old quantities until Warehouse acknowledges it.`);
once("if(next.status!=='PROCESSING'||next.change)fail('Resolve changes before confirming loading complete.');\n  checkSupply(next,context);", "if(next.status!=='PROCESSING'||next.change)fail('Resolve changes before confirming loading complete.');\n  if(next.stockDamageReviewRequired===true)fail('Warehouse must recheck damaged packing before confirming loading complete.');\n  checkDamageSupply(next,context,true);");
once("  checkSupply(next,context);next.status='PROCESSING';delete next.completedAt;", "  checkDamageSupply(next,context);next.status='PROCESSING';delete next.completedAt;");
once(" if(list.status!=='COMPLETED'||list.change||list.invoiceId||list.dispatchedAt)", " if(list.status!=='COMPLETED'||list.change||list.invoiceId||list.dispatchedAt||list.stockDamageReviewRequired===true)");
const model=source;
source=fs.readFileSync(path.join(__dirname,'../../backend/packingListOperations.js'),'utf8').replace(/\r\n/g,'\n');
once("const validEvidence=line=>",`export const PACKING_CURRENT_DAMAGE_READ_VERSION=1;
const damageCases=(rows,list,pending)=>Array.isArray(rows)&&new Set(rows.map(row=>row?.caseId)).size===rows.length&&rows.every(row=>row&&Object.keys(row).length===2&&typeof row.caseId==='string'&&row.caseId.length>0&&row.caseId.length<=128&&typeof row.taskId==='string'&&row.taskId.length>0&&row.taskId.length<=128&&(!pending||list.lines.some(line=>line.taskId===row.taskId)));
function checkDamageMetadata(list){
 if(list.stockDamageReviewRequired!==undefined&&typeof list.stockDamageReviewRequired!=='boolean'||list.stockDamageCases!==undefined&&(typeof list.stockDamageReviewRequired!=='boolean'||!damageCases(list.stockDamageCases,list,true))||list.stockDamageReviewRequired===true&&!(list.stockDamageCases?.length>0)||list.stockDamageReviewRequired!==true&&list.stockDamageCases?.length>0)throw Error('Packing damage review requires inspection.');
 const reviewed=list.stockDamageReview;
 if(reviewed!==undefined&&(!reviewed||Object.keys(reviewed).length!==2||!damageCases(reviewed.cases,list,false)||!reviewed.cases.length||typeof reviewed.at!=='string'||!Number.isFinite(Date.parse(reviewed.at))||new Date(reviewed.at).toISOString()!==reviewed.at))throw Error('Packing damage recheck evidence requires review.');
}
const validEvidence=line=>`);
once('  ids.add(list.id);return JSON.parse(JSON.stringify(list));','  checkDamageMetadata(list);ids.add(list.id);return JSON.parse(JSON.stringify(list));');
for(const [name,text] of Object.entries({'packingListModel.candidate.js':model,'packingListOperations.candidate.js':source})){
 const target=path.join(__dirname,name);new Function(text.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==text)throw Error('Packing damage candidate differs: '+name);}else fs.writeFileSync(target,text);
}
process.stdout.write('Original packing damage model/reader '+(process.argv.includes('--check')?'verified':'built')+'; no deployment\n');
