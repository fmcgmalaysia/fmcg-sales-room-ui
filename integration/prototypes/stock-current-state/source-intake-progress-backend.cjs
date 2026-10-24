'use strict';
// Typed progress only: keep original immutable Source snapshot and mutation lock.
function once(source, before, after) { if (source.split(before).length !== 2) throw Error('Exact original intake progress anchor changed'); return source.replace(before, () => after); }
function delivery(source) {
  source = once(source, '    let receipt;\n    try { receipt = verifiedReceipt(await deliver(body), body);', `    let receipt,progressError=null;
    try {
      const result=await deliver(body);
      if(result?.ok===false&&result.pending===true&&result.orderId===body.orderId&&result.destination===body.destination&&result.submissionId===body.submissionId
        &&['BEFORE','APPLY','VERIFY'].includes(result.phase)&&Number.isSafeInteger(result.completedCount)&&Number.isSafeInteger(result.totalRecords)
        &&result.totalRecords>0&&result.completedCount>=0&&result.completedCount<=result.totalRecords){
        progressError=new Error('Master intake is still processing the original submission.');
        progressError.stockIntakeProgress={ok:false,pending:true,orderId:body.orderId,destination:body.destination,submissionId:body.submissionId,
          phase:result.phase,completedCount:result.completedCount,totalRecords:result.totalRecords};throw progressError;
      }
      receipt=verifiedReceipt(result,body);`);
  return once(source, '    catch (error) {\n      // Keep the saved snapshot', '    catch (error) {\n      if(progressError&&error===progressError)throw error;\n      // Keep the saved snapshot');
}
function onboarding(source) {
  source = once(source, 'export const submitSalesRoomOrder = webMethod(', `function originalIntakeProgress(error,orderId,target){
  const progress=error?.stockIntakeProgress;
  if(progress?.ok!==false||progress.pending!==true||progress.orderId!==normalize(orderId)||progress.destination!==target||progress.submissionId!==target+'-'+normalize(orderId)
    ||!['BEFORE','APPLY','VERIFY'].includes(progress.phase)||!Number.isSafeInteger(progress.completedCount)||!Number.isSafeInteger(progress.totalRecords)
    ||progress.totalRecords<=0||progress.completedCount<0||progress.completedCount>progress.totalRecords)return null;
  return Object.freeze({ok:false,pending:true,orderId:normalize(orderId),destination:target,submissionId:progress.submissionId,
    phase:progress.phase,completedCount:progress.completedCount,totalRecords:progress.totalRecords});
}
export const submitSalesRoomOrder = webMethod(`);
  return once(source, `        if (entered) throw error;
        receipt = await submitNctSalesOrder({ ...input, initialError: error });`, `        if (entered) {const progress=originalIntakeProgress(error,orderId,target);if(progress)return progress;throw error;}
        try {receipt = await submitNctSalesOrder({ ...input, initialError: error });}
        catch(retryError){const progress=originalIntakeProgress(retryError,orderId,target);if(progress)return progress;throw retryError;}`);
}
module.exports = { delivery, onboarding };
