// Plans changes to the existing source allocation ledger. No stock balance or writes.
const whole=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
const copy=value=>JSON.parse(JSON.stringify(value));
const sum=rows=>rows.reduce((n,row)=>n+row.quantity,0);
const matches=(a,b)=>a.barcode===b.barcode&&a.packing===b.packing&&a.ea===b.ea;
function checked(context){
 if(!['NCT','GHR'].includes(context.company)||!Array.isArray(context.tasks)||!Array.isArray(context.sources)||!Array.isArray(context.loans))throw Error('Allocation context requires review.');
 if(new Set(context.tasks.map(row=>row.id)).size!==context.tasks.length||new Set(context.sources.map(row=>row.id)).size!==context.sources.length)throw Error('Duplicate allocation identity.');
 for(const source of context.sources){
  if(source.company!==context.company||!source.id||!whole(source.usableReceived)||!whole(source.availablePhysical)||source.availablePhysical>source.usableReceived||!Array.isArray(source.targets)||new Set(source.targets.map(row=>row.taskId)).size!==source.targets.length||source.targets.some(row=>!whole(row.quantity)||!context.tasks.some(task=>task.id===row.taskId&&matches(task,source)))||sum(source.targets)>source.usableReceived&&!(source.excluded>=sum(source.targets)-source.usableReceived))throw Error('Physical source allocation requires review.');
 }
 for(const task of context.tasks){
  if(task.company!==context.company||!whole(task.demand)||!Array.isArray(task.batches)||new Set(task.batches.map(row=>row.id)).size!==task.batches.length||task.batches.some(row=>!row.id||!whole(row.quantity))||sum(task.batches)!==task.demand)throw Error('Customer batch identity requires review.');
  if(sum(context.sources.flatMap(source=>source.targets.filter(row=>row.taskId===task.id)))>task.demand)throw Error('Customer allocation exceeds demand.');
 }
 for(const loan of context.loans)if(!loan.id||!whole(loan.outstanding)||!loan.borrowerTaskId||!loan.lenderTaskId||loan.borrowerTaskId===loan.lenderTaskId)throw Error('Borrowing responsibility requires review.');
 return context;
}
function targetFor(context,taskId,batchId){
 const task=context.tasks.find(row=>row.id===taskId),batch=task?.batches.find(row=>row.id===batchId);
 if(!task||!batch||task.archived||task.invoiceLocked)throw Error('Select an active, unlocked customer batch.');
 if(typeof task.barcode!=='string'||!task.barcode.trim()||typeof task.packing!=='string'||!task.packing.trim()||!Number.isSafeInteger(task.ea)||task.ea<=0)throw Error('Confirm barcode, packing and cartons before allocating stock.');
 return {task,batch};
}
function assignedToBatch(source,task,batchId){
 const target=source.targets.find(row=>row.taskId===task.id);if(!target||target.quantity===0)return 0;
 // Multiple shipment batches require an explicit server-resolved distribution.
 if(task.batches.length===1)return target.quantity;
 if(!Array.isArray(target.batches)||new Set(target.batches.map(row=>row.id)).size!==target.batches.length||target.batches.some(row=>!whole(row.quantity)||!task.batches.some(batch=>batch.id===row.id))||sum(target.batches)!==target.quantity)throw Error('Resolve source batch ownership before allocating.');
 return target.batches.find(row=>row.id===batchId)?.quantity||0;
}
function availableSources(context,task){return context.sources.filter(row=>row.received===true&&!row.blocked&&sum(row.targets)<=row.usableReceived&&matches(row,task));}
function free(source){return Math.max(0,Math.min(source.availablePhysical,source.usableReceived-sum(source.targets)));}
export function quoteCustomerAllocation(context,{taskId,batchId}){
 checked(context);const {task,batch}=targetFor(context,taskId,batchId),sources=availableSources(context,task);
 const assigned=context.sources.reduce((n,source)=>n+assignedToBatch(source,task,batchId),0);
 if(assigned>batch.quantity)throw Error('Batch allocation exceeds demand.');
 const freeQuantity=sources.reduce((n,source)=>n+free(source),0),useFree=Math.min(batch.quantity-assigned,freeQuantity),shortage=batch.quantity-assigned-useFree;
 const donors=context.tasks.filter(row=>row.id!==taskId&&row.customerId!==task.customerId&&!row.archived&&!row.invoiceLocked&&!row.held&&!row.returnLocked&&matches(row,task)&&!context.loans.some(loan=>(loan.borrowerTaskId===row.id||loan.lenderTaskId===row.id)&&loan.outstanding>0)).map(donor=>({taskId:donor.id,customerId:donor.customerId,quantity:sources.reduce((n,source)=>n+Math.min(source.availablePhysical,source.targets.find(row=>row.taskId===donor.id)?.quantity||0),0)})).filter(row=>row.quantity>0);
 return {version:context.version,taskId,batchId,demand:batch.quantity,assigned,freeQuantity,useFree,shortage,donors};
}
function changeQuantity(source,task,batchId,delta){
 let target=source.targets.find(row=>row.taskId===task.id);
 if(!target){target={taskId:task.id,quantity:0,batches:[]};source.targets.push(target);}
 if(task.batches.length>1)assignedToBatch(source,task,batchId);
 target.quantity+=delta;
 if(target.quantity<0)throw Error('Allocation cannot become negative.');
 if(task.batches.length===1){target.batches=[{id:task.batches[0].id,quantity:target.quantity}];return;}
 let batch=target.batches.find(row=>row.id===batchId);if(!batch){batch={id:batchId,quantity:0};target.batches.push(batch);}batch.quantity+=delta;
 if(batch.quantity<0)throw Error('Batch allocation cannot become negative.');
}
export function planCustomerAllocation(context,input){
 const quote=quoteCustomerAllocation(context,input);
 if(input.version!==context.version)throw Error('Stock, Desk or allocations changed. Refresh before confirming.');
 const {task}=targetFor(context,input.taskId,input.batchId);
 if(context.sources.some(source=>sum(source.targets)>source.usableReceived&&source.targets.some(target=>target.taskId===task.id&&target.quantity>0)))throw Error('Review quarantined stock and reconcile this allocation before assigning more cartons.');
 if(context.loans.some(loan=>loan.lenderTaskId===task.id&&loan.outstanding>0))throw Error('Use Repay to link received stock to this customer outstanding borrowing responsibility.');
 if(task.held)throw Error('Release the active Desk instruction before changing its allocation.');
 const borrowed=input.borrow===true?quote.shortage:0;
 if(!quote.useFree&&!borrowed&&!context.sources.some(source=>source.implicit&&source.targets.some(row=>row.taskId===task.id&&row.quantity>0)))throw Error('Allocation has not changed.');
 const donor=borrowed&&context.tasks.find(row=>row.id===input.donorTaskId),offered=quote.donors.find(row=>row.taskId===input.donorTaskId);
 if(borrowed&&(!offered||offered.quantity<borrowed))throw Error('Selected customer has insufficient unheld stock to borrow.');
 const next=copy(context),changes=[],loanSources=[];
 let remainingFree=quote.useFree,remainingBorrow=borrowed;
 for(const source of availableSources(next,task)){
  let changed=false;const take=Math.min(remainingFree,free(source));let physicalBudget=source.availablePhysical-take;
  if(take){changeQuantity(source,task,input.batchId,take);remainingFree-=take;changed=true;}
  if(remainingBorrow){
   // Donor batches are taken explicitly and retained in the responsibility record.
   for(const batch of donor.batches){const owned=assignedToBatch(source,donor,batch.id),amount=Math.min(remainingBorrow,owned,physicalBudget);
    if(!amount)continue;changeQuantity(source,donor,batch.id,-amount);changeQuantity(source,task,input.batchId,amount);remainingBorrow-=amount;physicalBudget-=amount;changed=true;loanSources.push({sourceTaskId:source.id,lenderBatchId:batch.id,quantity:amount});
   }
  }
  if(changed)changes.push({sourceTaskId:source.id,targets:source.targets});
 }
 if(remainingFree||remainingBorrow)throw Error('Physical stock changed. Refresh before confirming.');
 for(const source of availableSources(next,task))if((source.implicit||source.bindingNeeded)&&source.targets.some(target=>target.taskId===task.id||borrowed&&target.taskId===donor.id)&&!changes.some(change=>change.sourceTaskId===source.id))changes.push({sourceTaskId:source.id,targets:source.targets});
 const loan=borrowed?{borrowerTaskId:task.id,borrowerBatchId:input.batchId,lenderTaskId:donor.id,quantity:borrowed,outstanding:borrowed,sources:loanSources}:null;
 return {changes,loan,assigned:quote.assigned+quote.useFree+borrowed,shortage:quote.shortage-borrowed,physicalDelta:0};
}
export function planCustomerRepayment(context,input){
 checked(context);if(input.version!==context.version)throw Error('Stock, Desk or allocations changed. Refresh before confirming.');
 const loan=context.loans.find(row=>row.id===input.loanId);
 if(!loan||!whole(input.quantity)||input.quantity===0||input.quantity>loan.outstanding)throw Error('Select a valid outstanding repayment.');
 const lender=context.tasks.find(row=>row.id===loan.lenderTaskId);
 if(!lender||lender.archived||lender.invoiceLocked||lender.held)throw Error('Lender task must remain active and available for repayment.');
 const next=copy(context),changes=[];let remaining=input.quantity;
 for(const source of availableSources(next,lender)){
  const earmarked=source.implicit?source.targets.find(target=>target.taskId===lender.id)?.quantity||0:0;
  // Do not materialize a whole earmark while clearing only part of its responsibility.
  const take=earmarked<=remaining&&earmarked<=source.availablePhysical?earmarked:0;
  if(take){changes.push({sourceTaskId:source.id,targets:source.targets});remaining-=take;}
  if(!remaining)break;
 }
 // Repayment uses physically free sources; a receipt alone never clears responsibility.
 for(const source of availableSources(next,lender)){
  let available=free(source);if(!available)continue;
  for(const batch of lender.batches){
   const total=next.sources.reduce((n,row)=>n+assignedToBatch(row,lender,batch.id),0),take=Math.min(remaining,available,batch.quantity-total);
   if(take>0){changeQuantity(source,lender,batch.id,take);remaining-=take;available-=take;}
  }
  if(JSON.stringify(source.targets)!==JSON.stringify(context.sources.find(row=>row.id===source.id).targets)&&!changes.some(change=>change.sourceTaskId===source.id))changes.push({sourceTaskId:source.id,targets:source.targets});
  if(!remaining)break;
 }
 if(remaining)throw Error('Insufficient free received stock or lender demand for repayment.');
 return {changes,loan:{...copy(loan),outstanding:loan.outstanding-input.quantity},physicalDelta:0};
}
export function planCustomerReturn(context,input){
 checked(context);if(input.version!==context.version)throw Error('Stock, Desk or allocations changed. Refresh before confirming.');
 const loan=context.loans.find(row=>row.id===input.loanId);
 if(!loan||!whole(input.quantity)||!input.quantity||input.quantity>loan.outstanding)throw Error('Select a valid unshipped return quantity.');
 const borrower=context.tasks.find(row=>row.id===loan.borrowerTaskId),lender=context.tasks.find(row=>row.id===loan.lenderTaskId);
 if(!borrower||!lender||borrower.held||lender.held||borrower.returnLocked||lender.returnLocked||borrower.invoiceLocked||lender.invoiceLocked||borrower.archived||lender.archived)throw Error('Release unstarted Desk instructions before returning borrowed stock; Loaded or invoiced stock cannot be reversed here.');
 const next=copy(context),changes=[];let remaining=input.quantity;
 for(const original of loan.sources){
  const source=next.sources.find(row=>row.id===original.sourceTaskId&&row.received&&!row.blocked&&sum(row.targets)<=row.usableReceived);if(!source)continue;
  const owned=assignedToBatch(source,borrower,loan.borrowerBatchId),lenderBatch=lender.batches.find(row=>row.id===original.lenderBatchId);if(!lenderBatch)throw Error('Lender batch changed. Resolve the original borrowing first.');
  const used=next.sources.reduce((n,row)=>n+assignedToBatch(row,lender,lenderBatch.id),0),take=Math.min(remaining,owned,original.quantity,source.availablePhysical,lenderBatch.quantity-used);
  if(take>0){changeQuantity(source,borrower,loan.borrowerBatchId,-take);changeQuantity(source,lender,lenderBatch.id,take);remaining-=take;if(!changes.some(row=>row.sourceTaskId===source.id))changes.push({sourceTaskId:source.id,targets:source.targets});}
  if(!remaining)break;
 }
 if(remaining)throw Error('Original borrowed cartons are no longer available to return. Repay with received free stock instead.');
 return {changes,loan:{...copy(loan),outstanding:loan.outstanding-input.quantity},physicalDelta:0};
}
export function planCustomerReconciliation(context,input){
 checked(context);if(input.version!==context.version)throw Error('Stock, Desk or allocations changed. Refresh before confirming.');
 const source=context.sources.find(row=>row.id===input.sourceTaskId),{task}=targetFor(context,input.taskId,input.batchId),reason=String(input.reason||'').trim();
 if(!source||!source.received||!(source.excluded>0)||!reason||reason.length>2000||!whole(input.quantity))throw Error('Select a quarantined receipt, the affected customer batch, a lower quantity and a reason.');
 if(task.held)throw Error('Release the active Desk instruction before correcting its allocation.');
 const before=assignedToBatch(source,task,input.batchId),delta=input.quantity-before;if(delta>=0)throw Error('Stock reconciliation may only reduce the affected allocation.');
 const next=copy(source);changeQuantity(next,task,input.batchId,delta);const target=next.targets.find(row=>row.taskId===task.id);
 if(target.quantity<(target.protectedQuantity||0))throw Error('Loaded or invoiced cartons cannot be removed.');
 if(task.batches.length>1&&task.returnLocked)throw Error('Loaded batch source correction requires supervised review.');
 if(sum(next.targets)>source.usableReceived)throw Error('Reduce allocation to no more than usable received stock; quarantined stock cannot be allocated.');
 return {changes:[{sourceTaskId:source.id,targets:next.targets}],loan:null,physicalDelta:0};
}
