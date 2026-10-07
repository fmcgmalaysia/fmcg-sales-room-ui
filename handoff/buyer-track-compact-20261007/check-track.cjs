const fs=require('fs'),assert=require('assert'),vm=require('vm');
const root='C:/FMCG-WIX-LOCAL/', repo=root+'worktrees/buyer-native-selection-download-room5/';
const before=fs.readFileSync(root+'handoff/buyer-track-compact-20261007/buyer-before.html','utf8'),after=fs.readFileSync(repo+'buyer-room.html','utf8');
const line=(s,name)=>s.split(/\r?\n/).find(x=>x.startsWith('function '+name+'('));
const protectedNames=['bySelectionOrder','renderMy','renderOrder','compactTime','confirmQuantityDraft','rememberQuantityDraft','isFoodItem','canReduceOrder','committedLineQty','effectiveRequestedQty','stageForLine','requestTimestamp','progressUpdated','allTrackingRows','allCompletedRows','renderTrackingRail','renderCompletedOrders','orderEditEntries','editHistoryHtml','applyData','showView'];
for(const name of protectedNames){assert(line(before,name),name);assert.equal(line(after,name),line(before,name),name+' changed');}
const oldLine=line(before,'trackingLineHtml'),newLine=line(after,'trackingLineHtml');
const oldReturn="return `<div class=\"tracking-row${changed?' alert':''}\"><div>${esc(line.barcode||'—')}</div>";
assert.equal(newLine.slice(newLine.indexOf(oldReturn)),oldLine.slice(oldLine.indexOf(oldReturn)),'Completed line output changed');
assert.equal(newLine.slice(0,newLine.indexOf('if(!completed)return')),oldLine.slice(0,oldLine.indexOf(oldReturn)),'Quantity/amount/progress calculations changed');
let clock="2026-10-10T04:00:00Z";class TestDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}}
const context={Intl,Date:TestDate};vm.createContext(context);vm.runInContext(line(after,'trackTime24'),context);
assert.equal(context.trackTime24('2026-10-06T16:05:00Z'),'07-10-26 00:05');
assert.equal(context.trackTime24('2026-10-07T15:59:00Z'),'07-10-26 23:59');
assert.equal(context.trackTime24(''),'—');assert.equal(context.trackTime24('bad'),'—');
const styles=s=>[...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
assert.deepEqual(styles(after).slice(0,-1),styles(before),'Existing CSS changed');
for(const id of ['myView','orderView','completedView','accountView']){const section=s=>s.match(new RegExp('<section id="'+id+'"[\\s\\S]*?</section>'))?.[0];assert.equal(section(after),section(before),id+' markup changed');}
console.log(JSON.stringify({protectedFunctions:protectedNames.length,completedRowIdentical:true,trackingCalculationsIdentical:true,existingCssIdentical:true,dateEdgeCases:4,otherViewMarkupIdentical:true,syntax:'checked separately'}));
const cbmContext={esc:x=>String(x),num:x=>Number(x)||0,money:x=>x.toFixed(2),effectiveRequestedQty:l=>l.requestedQtyCtn,committedLineQty:l=>l.committedQtyCtn??null,completedLineQty:()=>0,stageForLine:()=>2,progressUpdated:()=>'',canReduceOrder:()=>false,trackTime24:()=>'',requestTimestamp:()=>''};vm.createContext(cbmContext);vm.runInContext(line(after,'trackingLineHtml'),cbmContext);
const row=(qty,cbm)=>cbmContext.trackingLineHtml({order:{},line:{requestedQtyCtn:5,committedQtyCtn:qty,cbmPerCtn:cbm}});
assert(row(5,0).includes('cbm-zero-pill'));
assert(!row(5,.1).includes('cbm-zero-pill'));
assert(!row(null,0).includes('cbm-zero-pill'));
assert(!row(0,0).includes('cbm-zero-pill'));
assert(row(5,0).includes('<div>—</div><div></div>'));
assert(after.includes('title="默认为空格，只根据客户要求填写"'));
for(const match of after.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(!match[1].includes('src='))new vm.Script(match[2]);}
console.log('Supplement: zero/nonzero/pending/zero-qty CBM, blank Goods Exp, help text and syntax PASS');

clock='2026-10-07T16:05:00Z';assert.equal(context.trackTime24('2026-10-07T16:00:00Z'),'Today 00:00');assert.equal(context.trackTime24('2026-10-07T15:59:00Z'),'Yesterday 23:59');assert.equal(context.trackTime24('2026-10-06T15:59:00Z'),'06-10-26 23:59');assert.equal(context.trackTime24('2026-10-08T16:00:00Z'),'09-10-26 00:00');console.log('MYT Today/Yesterday/older/future day boundaries PASS');
