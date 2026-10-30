// Private operation receipts. A timeout is resumed with the same request, never a new identity.
import { createHash, randomUUID } from 'crypto';
export const operationId = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const copy = value => JSON.parse(JSON.stringify(value));
// CMS may reorder object fields. Values, extra fields and array order still matter.
const canonical = value => JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export function createOperationJournal({ store, now = () => new Date() }) {
  return async ({ collection, scope, entityId=scope, requestId, staff, input, prepare, apply, recoverCompleted }) => {
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || !staff?.memberId || !staff.staffId || !staff.staffName) throw Error('Verified employee and save identity are required.');
    const key = operationId(scope,requestId,staff.memberId), digest = operationId(input), resultId = operationId(key,'RESULT');
    const prior = await store.read(collection,resultId);
    if (prior) {
      if(prior.details.digest !== digest) throw Error('This save identity was already used for different changes.');
      if(!prior.details.recovered) return copy(prior.details.outcome);
    }
    const lockId = operationId(scope,'LOCK'), at = now().toISOString();
    const lock = await store.read(collection,lockId);
    if(prior&&lock?.details?.owner!==key)return copy(prior.details.outcome);
    if(lock&&lock.details?.owner===key&&lock.details?.digest===digest&&recoverCompleted){
      const prepared=await store.read(collection,key),plan=prepared?.details?.plan;
      if(prepared?.details?.digest!==digest||!plan)throw Error('Original save recovery is pending. Retain this request.');
      // Old PO writers check a 90s apply limit; legacy cleanup is serial. Do not
      // reclaim a live writer, or infer completion merely from an old lock.
      const quietMs=Math.max(300000,180000+10000*(plan.updates?.length||0));
      if(!Number.isFinite(Date.parse(plan.time))||now().getTime()-Date.parse(plan.time)<quietMs)throw Error('Original save is still processing. Retain this request.');
      const completed=await recoverCompleted(copy(plan),'VERIFY');
      if(!completed?.ok||completed.requestId!==requestId)throw Error('Original save recovery is pending. Retain this request.');
      let claim,claimId;
      for(let attempt=0;attempt<16;attempt++){
        claimId=operationId(key,'COMPLETED_RECOVERY',attempt);const previous=await store.read(collection,claimId);
        if(previous){if(previous.details?.owner!==key||previous.details?.digest!==digest||previous.details?.requestId!==requestId)throw Error('Original save recovery requires review. Retain this request.');if(!Number.isFinite(Date.parse(previous.details?.time))||now().getTime()-Date.parse(previous.details.time)<300000)throw Error('Original save recovery is still processing. Retain this request.');continue;}
        claim={_id:claimId,title:claimId,description:entityId,action:'PURCHASE_OPERATION_RECOVERY',activityTime:now(),actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,result:'PENDING',details:{requestId,owner:key,digest,time:now().toISOString(),nonce:randomUUID()}};
        try{await store.insert(collection,claim);}catch(error){const saved=await store.read(collection,claimId);if(saved?.details?.nonce!==claim.details.nonce)throw Error('Original save recovery is still processing. Retain this request.');}
        break;
      }
      if(!claim)throw Error('Original save recovery requires review. Retain this request.');
      const assertClaim=async()=>{const current=await store.read(collection,claimId);if(now().getTime()-Date.parse(claim.details.time)>=90000||current?.details?.nonce!==claim.details.nonce)throw Error('Original save recovery is pending. Retain this request.');};
      await assertClaim();
      const confirmed=await recoverCompleted(copy(plan),'VERIFY');
      if(!confirmed?.ok||canonical(confirmed)!==canonical(completed))throw Error('Original save recovery requires review. Retain this request.');
      let receipt=await store.read(collection,resultId);
      if(!receipt){const row={_id:resultId,title:resultId,description:entityId,action:'PURCHASE_OPERATION_RESULT',activityTime:now(),actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,result:'SAVED',message:'Purchase operation result recovered',details:{kind:'RESULT',time:now().toISOString(),actorStaffId:staff.staffId,actorStaffName:staff.staffName,actorMemberId:staff.memberId,requestId,digest,outcome:completed,recovered:true}};
        try{await store.insert(collection,row);receipt=row;}catch(error){receipt=await store.read(collection,resultId);if(!receipt)throw error;}
      }
      if(receipt.details?.digest!==digest||canonical(receipt.details?.outcome)!==canonical(completed))throw Error('Original save recovery requires review. Retain this request.');
      await recoverCompleted(copy(plan),'CLEANUP',assertClaim);
      await assertClaim();const current=await store.read(collection,lockId);
      if(current?.details?.owner!==key||current.details.digest!==digest)throw Error('Original save recovery requires review. Retain this request.');
      await store.remove(collection,lockId);
      await store.update(collection,{...claim,result:'SAVED',details:{...claim.details,completedAt:now().toISOString()}});
      return copy(completed);
    }
    // Never remove another operation's lock, including an old one. Recovery requires its receipt.
    if(lock) throw Error('A save is still processing. Refresh before retrying the same save.');
    const event = (id,kind,details) => ({_id:id,title:id,description:entityId,...(collection==='SharedSupplierActivity'?{}:{action:'PURCHASE_OPERATION_'+kind,activityTime:new Date(at),actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,result:kind==='RESULT'?'SAVED':kind,message:'Purchase operation '+kind.toLowerCase()}),details:{kind,time:at,actorStaffId:staff.staffId,
      actorStaffName:staff.staffName,actorMemberId:staff.memberId,requestId,digest,...details}});
    await store.insert(collection,event(lockId,'LOCK',{owner:key}));
    try {
      let prepared = await store.read(collection,key);
      if(prepared && prepared.details.digest !== digest) throw Error('This save identity was already used for different changes.');
      if(!prepared) prepared = await store.insert(collection,event(key,'PREPARED',{plan:await prepare()}));
      const outcome = await apply(copy(prepared.details.plan));
      await store.insert(collection,event(resultId,'RESULT',{outcome}));
      return copy(outcome);
    } finally {
      const current = await store.read(collection,lockId);
      if(current?.details?.owner === key) await store.remove(collection,lockId);
    }
  };
}
