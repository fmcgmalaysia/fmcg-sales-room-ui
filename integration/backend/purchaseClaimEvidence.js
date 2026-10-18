const money=value=>Number.isSafeInteger(value)&&value>0&&value<=999999999999;
const sum=(rows,key)=>rows.reduce((total,row)=>total+row[key],0);
export function validatePurchaseClaim(row,claim,claims){
 const item=(row.quantityCases||[]).find(item=>item.id===claim.caseId&&item.kind==='RECEIPT');
 if(!item||item.quantity<=0||claim.signature!==item.signature||claim.quantity!==item.quantity)throw Error('Shortage quantity changed; reconcile this case again.');
 if(!['REFUND','CREDIT'].includes(claim.outcome)||item.decision?.supplierDecision!==claim.outcome)throw Error('Shortage claim must match the Purchase supplier decision.');
 if(!money(claim.cents)||!claim.byStaffId||!claim.at||!claim.reason)throw Error('Confirm the actual shortage claim amount and reconciliation note.');
 const other=[...claims.filter(value=>value.caseId!==claim.caseId),...(row.stockCases||[]).map(value=>value.resolution?.financeApproval).filter(Boolean)];
 if(!Array.isArray(claim.cnAllocations)||!claim.cnAllocations.length||new Set(claim.cnAllocations.map(value=>value.fileId)).size!==claim.cnAllocations.length)throw Error('Assign supplier CN amounts to the shortage case.');
 for(const allocation of claim.cnAllocations){
  const doc=row.documents.find(doc=>doc.type==='CN'&&doc.linked&&!doc.superseded&&doc.fileId===allocation.fileId&&doc.sha256===allocation.sha256),amount=row.finance.amounts.find(value=>value.fileId===allocation.fileId&&value.sha256===doc?.sha256);
  const used=other.flatMap(value=>value.cnAllocations||[]).filter(value=>value.fileId===allocation.fileId).reduce((n,value)=>n+value.cents,0);
  if(!doc||!amount||!money(allocation.cents)||used+allocation.cents>amount.cents)throw Error('CN amount is unavailable, unverified or already assigned to another claim.');
 }
 if(sum(claim.cnAllocations,'cents')!==claim.cents)throw Error('CN allocations must equal the confirmed shortage claim.');
 if(claim.outcome==='REFUND'){
  if(!Array.isArray(claim.refundAllocations)||!claim.refundAllocations.length||new Set(claim.refundAllocations.map(value=>value.paymentId)).size!==claim.refundAllocations.length)throw Error('Assign received refund proofs to the shortage case.');
  for(const allocation of claim.refundAllocations){
   const payment=row.finance.payments.find(value=>value.id===allocation.paymentId&&value.direction==='REFUND'&&value.confirmed&&value.proof?.linked&&value.proof.sha256===allocation.sha256),used=other.flatMap(value=>value.refundAllocations||[]).filter(value=>value.paymentId===allocation.paymentId).reduce((n,value)=>n+value.cents,0);
   if(!payment||!money(allocation.cents)||used+allocation.cents>payment.cents)throw Error('Refund amount is unavailable or already assigned to another claim.');
  }
  if(sum(claim.refundAllocations,'cents')!==claim.cents)throw Error('Received refunds must cover the confirmed shortage claim.');
 }
 return claim;
}
export function purchaseClaimBlockers(row,finance){
 const claims=finance.quantityClaims||[],required=(row.quantityCases||[]).filter(item=>item.kind==='RECEIPT'&&item.quantity>0),errors=[];
 if(new Set(claims.map(claim=>claim.caseId)).size!==claims.length)return ['Duplicate shortage claim requires financial review.'];
 for(const item of required){if(!claims.some(claim=>claim.caseId===item.id))errors.push('Reconcile each supplier shortage with its CN / 请逐项核对少货及对应CN');}
 for(const claim of claims){try{validatePurchaseClaim({...row,finance},claim,claims);}catch(error){errors.push(error.message);}}
 return [...new Set(errors)];
}
export function preparePurchaseClaim(row,input,identity,reason){
 const docs=row.documents||[],payments=row.finance.payments||[];
 const claim={caseId:input.caseId,signature:input.signature,quantity:input.quantity,cents:input.cents,outcome:input.outcome,reason,...identity,
  cnAllocations:(input.cnAllocations||[]).map(value=>({fileId:value.fileId,cents:value.cents,sha256:docs.find(doc=>doc.fileId===value.fileId)?.sha256})),
  refundAllocations:input.outcome==='REFUND'?(input.refundAllocations||[]).map(value=>({paymentId:value.paymentId,cents:value.cents,sha256:payments.find(payment=>payment.id===value.paymentId)?.proof?.sha256})):[]};
 validatePurchaseClaim(row,claim,row.finance.quantityClaims||[]);return claim;
}
