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
const context={Intl,Date};vm.createContext(context);vm.runInContext(line(after,'trackTime24'),context);
assert.equal(context.trackTime24('2026-10-06T16:05:00Z'),'07-10-26 00:05');
assert.equal(context.trackTime24('2026-10-07T15:59:00Z'),'07-10-26 23:59');
assert.equal(context.trackTime24(''),'—');assert.equal(context.trackTime24('bad'),'—');
const styles=s=>[...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
assert.deepEqual(styles(after).slice(0,-1),styles(before),'Existing CSS changed');
for(const id of ['myView','orderView','completedView','accountView']){const section=s=>s.match(new RegExp('<section id="'+id+'"[\\s\\S]*?</section>'))?.[0];assert.equal(section(after),section(before),id+' markup changed');}
console.log(JSON.stringify({protectedFunctions:protectedNames.length,completedRowIdentical:true,trackingCalculationsIdentical:true,existingCssIdentical:true,dateEdgeCases:4,otherViewMarkupIdentical:true,syntax:'checked separately'}));
