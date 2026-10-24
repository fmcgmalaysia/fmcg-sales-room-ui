// Private operation receipts. A timeout is resumed with the same request, never a new identity.
import { createHash } from 'crypto';
export const operationId = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const copy = value => JSON.parse(JSON.stringify(value));
export function createOperationJournal({ store, now = () => new Date() }) {
  return async ({ collection, scope, entityId=scope, requestId, staff, input, prepare, apply }) => {
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || !staff?.memberId || !staff.staffId || !staff.staffName) throw Error('Verified employee and save identity are required.');
    const key = operationId(scope,requestId,staff.memberId), digest = operationId(input), resultId = operationId(key,'RESULT');
    const prior = await store.read(collection,resultId);
    if (prior) {
      if(prior.details.digest !== digest) throw Error('This save identity was already used for different changes.');
      return copy(prior.details.outcome);
    }
    const lockId = operationId(scope,'LOCK'), at = now().toISOString();
    const lock = await store.read(collection,lockId);
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
