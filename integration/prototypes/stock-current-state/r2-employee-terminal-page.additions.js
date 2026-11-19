// NEW temporary acceptance addition only. Existing capacity/employee gates stay CLOSED.
import { verifyPurchaseTerminal, verifyWarehouseTerminal } from 'backend/r2EmployeeTerminalAcceptance.web.js';
import terminalWindowFrontend from 'wix-window-frontend';
import terminalSeoFrontend from 'wix-seo-frontend';
import { session as terminalSession } from 'wix-storage-frontend';
const R2_EMPLOYEE_TERMINAL_PAGE_ENABLED=false;
const TERMINAL_AUTHORITY_BUILD='__TERMINAL_AUTHORITY_BUILD__';
const TERMINAL_PROBE_SOURCE='__TERMINAL_PROBE_SOURCE__';
$w.onReady(async function(){
 if(!R2_EMPLOYEE_TERMINAL_PAGE_ENABLED||terminalWindowFrontend.rendering.env!=='browser')return;
 try{
  await terminalSeoFrontend.setTitle('R2 Employee Terminal Check RUNNING');
  for(const [profile,check] of [['PURCHASE',verifyPurchaseTerminal],['WAREHOUSE',verifyWarehouseTerminal]]){
   const current=await check({step:'INSPECT'});
   const paired=result=>result?.schema==='R2_EMPLOYEE_TERMINAL_ACCEPTANCE_V1'&&result.cohort==='MASTER_20261024_R2'
    &&result.profile===profile&&result.authorityBuild===TERMINAL_AUTHORITY_BUILD&&result.probeSourceSha256===TERMINAL_PROBE_SOURCE
    &&result.oldFixturesAccessed===false&&result.businessAuthorizationAccepted===false&&result.writerCoverageAccepted===false&&result.activationAllowed===false;
   if(!paired(current)||current.ok!==true||current.mutationAttempted!==false)throw Error('Paired employee inspection unconfirmed');
   if(current.terminalReceiptVerified===true&&current.ordinaryStaffWriteAccepted===true&&current.retainedRecords===4){
    console.info('R2_EMPLOYEE_TERMINAL_PAGE '+JSON.stringify(current));continue;
   }
   const key='R2_TERMINAL_ATTEMPT_'+TERMINAL_AUTHORITY_BUILD+'_'+profile;
   if(current.retainedRecords!==0||terminalSession.getItem(key))throw Error('Prior employee attempt retained; inspect only, no retry');
   // Persist BEFORE dispatch. Reload/SSR must not create a second RUN attempt.
   terminalSession.setItem(key,'ATTEMPTED');
   if(terminalSession.getItem(key)!=='ATTEMPTED')throw Error('Session attempt guard unconfirmed');
   const result=await check({step:'RUN'});
   if(!paired(result)||result.ok!==true||result.terminalReceiptVerified!==true||result.ordinaryStaffWriteAccepted!==true
    ||result.retainedRecords!==4||result.mutationAttempted!==true)throw Error('Native employee terminal result unconfirmed; inspect only');
   console.info('R2_EMPLOYEE_TERMINAL_PAGE '+JSON.stringify(result));
  }
  await terminalSeoFrontend.setTitle('R2 Employee Terminal Check PASS');
 }catch(error){
  terminalSeoFrontend.setTitle('R2 Employee Terminal Check STOP').catch(()=>{});
  console.error('R2_EMPLOYEE_TERMINAL_PAGE_STOP '+JSON.stringify({error:error.message,noAutomaticRetryResetOrCleanup:true}));
 }
});
