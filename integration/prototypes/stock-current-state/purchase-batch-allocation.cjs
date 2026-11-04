'use strict';
// Display only: preserve the existing confirmed batch calculation. Never divide
// customer totals anew or repeat the root quantity on each shipment row.
function batchAllocation(root) {
  const whole=n=>Number.isSafeInteger(n)&&n>=0,entries=root.batchEntitlements;
  if(!whole(root.stockAllocatedCumulative)||!Array.isArray(entries)||!entries.length)return undefined;
  const seen=new Set(),result=[];
  for(const entry of entries){
    if(!entry.id||seen.has(entry.id)||!whole(entry.quantity)||!whole(entry.metrics?.received)
      ||entry.metrics.received>entry.quantity)return undefined;
    seen.add(entry.id);result.push({id:entry.id,demand:entry.quantity,allocated:entry.metrics.received});
  }
  const sum=result.reduce((n,e)=>n+e.allocated,0);
  return Number.isSafeInteger(sum)&&sum===root.stockAllocatedCumulative?result:undefined;
}
module.exports={batchAllocation};
