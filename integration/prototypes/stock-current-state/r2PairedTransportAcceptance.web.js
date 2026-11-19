import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { webMethod, Permissions } from 'wix-web-module';
function createPairedTransportAcceptance({ fetch, getSecret }) {
  if(typeof fetch!=='function'||typeof getSecret!=='function')throw Error('Existing server integration dependencies required');
  const endpoint='https://fmcg999.wixstudio.com/master/_functions/r2PurchaseQuantities?rc=test-site';
  const cohort='MASTER_20261024_R2';
  const fixedBody={company:'NCT',customerId:'R2-TRANSPORT-READ-FIXTURE',
    orders:[{orderId:'R2-TRANSPORT-READ-FIXTURE-ORDER',submissionId:'R2-TRANSPORT-READ-FIXTURE-SUBMISSION'}]};
  return async input=>{
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).join(',')!=='step'
      ||!['COHORT_REJECTION','AUTH_REJECTION','AUTHORIZED_READ'].includes(input.step))throw Error('Fixed paired read step required');
    const report={schema:'R2_PAIRED_TRANSPORT_ACCEPTANCE_V1',cohort,step:input.step,
      target:'MASTER_TEST_SITE_READ_ONLY',testSiteRouting:'rc=test-site',credentialDisclosed:false,
      inventoryMutationCapability:false,sourceOrderMutationCapability:false,
      ordinarySourceUserAccepted:false,writerCoverageAccepted:false,activationAllowed:false};
    try{
      const credential=input.step==='AUTHORIZED_READ'?await getSecret('MASTER_INTAKE_SHARED_SECRET'):'R2_FIXED_INVALID_CONTROL';
      if(typeof credential!=='string'||!credential)return{...report,ok:false,stage:'CONFIGURED_INTEGRATION_UNAVAILABLE'};
      const response=await fetch(endpoint,{method:'post',headers:{'Content-Type':'application/json',
        'X-FMCG-Cohort':input.step==='COHORT_REJECTION'?'R2_FIXED_INVALID_COHORT':cohort,
        Authorization:'Bearer '+credential},body:JSON.stringify(fixedBody)});
      const body=await response.json(),status=response.status;
      const cohortRejected=status===409&&body?.ok===false&&body.error==='Order program changed. Refresh the original order; no new receipt was created.';
      const unauthorizedRejected=status===401&&body?.ok===false&&body.error==='Unauthorized request.';
      // A specific handler-owned503 proves that its credential check passed,
      // but does NOT identify the later read failure or prove a usable snapshot.
      const guardedReadReached=status===503&&body?.ok===false
        &&body.error==='Current purchase quantities could not be confirmed. Please refresh.';
      const emptyReadConfirmed=status===200&&Array.isArray(body?.orders)&&body.orders.length<=1
        &&body.orders.every(row=>row.orderId===fixedBody.orders[0].orderId);
      const accepted=input.step==='COHORT_REJECTION'?cohortRejected:input.step==='AUTH_REJECTION'?unauthorizedRejected:guardedReadReached||emptyReadConfirmed;
      return{...report,ok:accepted,httpStatus:Number.isSafeInteger(status)?status:null,
        stage:accepted?'FIXED_TRANSPORT_STEP_CONFIRMED':'TRANSPORT_UNCONFIRMED',
        cohortRejected,unauthorizedRejected,authorizedHandlerReached:input.step==='AUTHORIZED_READ'&&(guardedReadReached||emptyReadConfirmed),
        businessReadConfirmed:input.step==='AUTHORIZED_READ'&&emptyReadConfirmed,maintenanceCauseProven:false};
    }catch(_error){
      // Do not propagate a fetch exception that might include request headers.
      return{...report,ok:false,stage:'TRANSPORT_OUTCOME_UNCONFIRMED',noAutomaticRetry:true};
    }
  };
}
const inspect=createPairedTransportAcceptance({fetch,getSecret});
export const inspectMasterTestTransport=webMethod(Permissions.Admin,async input=>{const result=await inspect(input);console.info('R2_PAIRED_TRANSPORT_RECEIPT '+JSON.stringify(result));return result;});
