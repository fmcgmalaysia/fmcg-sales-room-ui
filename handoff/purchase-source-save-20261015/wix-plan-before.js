// Supplier plans are immutable activity revisions, not warehouse stock receipts.
export function readPurchasePlan(task, activity) {
  const pending=activity.filter(event=>event.action==='PURCHASE_PLAN_SAVED'&&event.result==='SAVED'&&event.imageAltText===task.title);
  let revision='',totalCtn=null,last=null;
  while(pending.length){
    const next=pending.filter(event=>event.details?.beforeRevision===revision);
    if(next.length!==1)throw Error('Procurement plan history requires review.');
    const event=next[0],details=event.details;
    if(event.description!==task.description||event.image!==task.imageAltText||!event.title||!Number.isSafeInteger(details.totalCtn)||details.totalCtn<1||details.totalCtn>9999)throw Error('Procurement plan identity or quantity requires review.');
    if(details.extraCtn!==undefined&&(!Number.isSafeInteger(details.extraCtn)||details.extraCtn<0||details.extraCtn>details.totalCtn))throw Error('Procurement stock quantity requires review.');
    revision=event.title;totalCtn=details.totalCtn;last=event;pending.splice(pending.indexOf(event),1);
  }
  return {revision,totalCtn,costing:last?.details?.costing||null,draftPlan:last?.details?.draftPlan===true,extraCtn:Number.isSafeInteger(last?.details?.extraCtn)?last.details.extraCtn:null,extraKind:last?.details?.extraKind||'',supplierId:last?.details?.supplierId||'',updatedAt:last?.activityTime||null,updatedBy:last?.initiatedByStaffName||'',confirmedAt:last?.details?.supplierConfirmed===true?last.activityTime:null,confirmedBy:last?.details?.supplierConfirmed===true?last.initiatedByStaffName:''};
}

// The plan revision owns the original inputs; legacy task prices are a derived average.
export function calculatePlanCosting(input,totalCtn,ea) {
  if(!input||input.schema!==1||!['NORMAL','FOC'].includes(input.mode)||!['PRICES','TOTAL'].includes(input.moneySource))throw Error('Check the procurement costing method.');
  const {paidCtn,freeCtn}=input,keys=['lpPc','lpCtn','disc1','disc2','disc3'],raw=input.prices;
  if(!Number.isSafeInteger(paidCtn)||paidCtn<1||!Number.isSafeInteger(freeCtn)||freeCtn<0||paidCtn+freeCtn!==totalCtn||totalCtn>9999||input.mode==='NORMAL'&&freeCtn!==0)throw Error('Paid cartons plus FOC cartons must equal the supplier total.');
  if(!Number.isSafeInteger(ea)||ea<1)throw Error('EA is unavailable. Cost cannot be calculated.');
  if(!raw||keys.some(key=>input.moneySource==='TOTAL'&&raw[key]===null?false:typeof raw[key]!=='number'||!Number.isFinite(raw[key])||raw[key]<0)||raw.disc1>1||raw.disc2>1)throw Error('Confirm all original supplier prices and discounts.');
  const paidUnit=keys.every(key=>Number.isFinite(raw[key]))?raw.lpCtn*(1-raw.disc1)*(1-raw.disc2)-raw.disc3:null;
  if(paidUnit<0)throw Error('Net cost cannot be negative.');
  const amountCents=input.moneySource==='TOTAL'?input.amountCents:Math.round(paidUnit*paidCtn*100);
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>99999999900)throw Error('Confirm a positive supplier line amount. Zero-value procurement needs separate financial review.');
  const average=amountCents/100/totalCtn;
  return {schema:1,mode:input.mode,moneySource:input.moneySource,paidCtn,freeCtn,totalCtn,prices:Object.fromEntries(keys.map(key=>[key,raw[key]])),amountCents,averageCostCtn:average,ea,
    manualFields:keys.filter(key=>input.manualFields?.includes(key)),reference:input.reference?{at:String(input.reference.at||''),source:String(input.reference.source||'POINTBASE')}:null};
}

// A revision freezes all existing sibling shares. Editing B never reallocates A or C.
export function readPurchaseShares(rootId,activity) {
  const pending=activity.filter(event=>event.action==='PURCHASE_SOURCE_SHARES_SAVED'&&event.result==='SAVED'&&event.imageAltText===rootId);
  let revision='',shares=null;
  while(pending.length){const next=pending.filter(event=>event.details?.beforeRevision===revision);if(next.length!==1)throw Error('Supplier allocation history requires review.');
    const event=next[0];if(!event.title||!Array.isArray(event.details.shares)||event.details.shares.some(row=>!row.taskId||!Number.isSafeInteger(row.totalCtn)||row.totalCtn<0||!Number.isSafeInteger(row.customerCtn)||row.customerCtn<0||row.customerCtn>row.totalCtn)||new Set(event.details.shares.map(row=>row.taskId)).size!==event.details.shares.length)throw Error('Supplier allocation identity or shares require review.');
    revision=event.title;shares=event.details.shares;pending.splice(pending.indexOf(event),1);
  }
  return {revision,shares};
}

export function planPurchaseShares(workspace,activity,rootId,taskId,totalCtn) {
  const root=workspace.tasks.find(row=>row.id===rootId);if(!root)throw Error('Customer demand is unavailable.');
  const previous=readPurchaseShares(rootId,activity),group=workspace.tasks.filter(row=>row.id===rootId||row.customerDemandTaskId===rootId);
  const shares=group.filter(row=>row.id!==taskId).map(row=>({taskId:row.id,totalCtn:row.procurement?.totalCtn||0,customerCtn:Math.max(0,(row.procurement?.totalCtn||0)-(row.procurement?.expectedExtra||0))}));
  const otherCustomer=shares.reduce((sum,row)=>sum+row.customerCtn,0);
  if(otherCustomer>root.ord)throw Error('Existing customer allocations exceed demand. Review them before saving.');
  const customerCtn=Math.min(totalCtn,root.ord-otherCustomer);shares.push({taskId,totalCtn,customerCtn});
  return {rootId,beforeRevision:previous.revision,shares:shares.sort((a,b)=>a.taskId.localeCompare(b.taskId)),customerCtn,extraCtn:totalCtn-customerCtn};
}
