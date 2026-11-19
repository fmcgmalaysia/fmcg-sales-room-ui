'use strict';
// Minimal CURRENT-only calculation seams. All original event/version/permission
// code stays; default context takes byte-equivalent legacy quantity expressions.
const fs = require('node:fs'), path = require('node:path');
let source = fs.readFileSync(path.join(__dirname, '../../backend/warehousePreparation.js'), 'utf8').replace(/\r\n/g, '\n');
function once(old, next) { if (source.split(old).length !== 2) throw Error('Original Warehouse Ready anchor changed'); source = source.replace(old, next); }
const helper = `function currentTaskSent(taskId,context,shipments){
 if(context.stockCurrentReadyVersion===2){const n=context.stockDispatchedByTask?.[taskId];if(!Number.isSafeInteger(n)||n<0)throw Error('Current task dispatch requires review.');return n;}
 return shipments.filter(s=>s.status==='DISPATCHED').flatMap(s=>s.lines).filter(l=>l.taskId===taskId).reduce((n,l)=>n+l.quantity,0);
}
function currentSourceSent(sourceId,taskId,context){
 const source=context.stockDispatchedBySource?.[sourceId];if(!source)throw Error('Current source dispatch requires review.');
 const n=Object.hasOwn(source,taskId)?source[taskId]:0;if(!Number.isSafeInteger(n)||n<0)throw Error('Current source dispatch requires review.');return n;
}
export const WAREHOUSE_CURRENT_READY_VERSION = 2;
`;
once('function readyStockFor(task,context,shipments,onlySourceId){', helper + 'function readyStockFor(task,context,shipments,onlySourceId){');
once('const shippedFrom=(sourceId,targetId)=>dispatched.filter', 'const shippedFrom=(sourceId,targetId)=>context.stockCurrentReadyVersion===2?currentSourceSent(sourceId,targetId,context):dispatched.filter');
once("const sent=dispatched.filter(l=>l.taskId===task.id).reduce((n,l)=>n+l.quantity,0);", 'const sent=currentTaskSent(task.id,context,shipments);');
once('shipments=readCustomerShipments(context.activity),customers=', 'shipments=context.stockCurrentReadyVersion===2?[]:readCustomerShipments(context.activity),customers=');
once("const sent=shipments.filter(s=>s.status==='DISPATCHED').flatMap(s=>s.lines).filter(l=>l.taskId===task.id).reduce((n,l)=>n+l.quantity,0),batchStart=", 'const sent=currentTaskSent(task.id,context,shipments),batchStart=');
const target = path.join(__dirname, 'warehousePreparation.candidate.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Warehouse current Ready candidate differs');
} else fs.writeFileSync(target, source);
process.stdout.write('Warehouse CURRENT Ready candidate ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; no live edits\n');
