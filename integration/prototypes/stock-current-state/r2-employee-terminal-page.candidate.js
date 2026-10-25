import { verifyR2Intake } from 'backend/r2IntakeCapacityAcceptance.web.js';
// Temporary NEW unpublished acceptance page only. The backend remains Admin-only,
// physically scoped to the one retained StockProtocolTest fixture. Never seed,
// reset, delete, activate, switch request identity or retry an uncertain call.
const R2_INTAKE_PAGE_ENABLED = false;
$w.onReady(async function () {
  if (!R2_INTAKE_PAGE_ENABLED) return;
  const receipts = [];
  const call = async step => {
    const result = await verifyR2Intake({ step });
    console.info('R2INTAKE_PAGE_RECEIPT ' + JSON.stringify(result));
    if (result?.ok !== true || result.schema !== 'R2_REAL_INTAKE_CAPACITY_V1' || result.step !== step) throw Error('Unconfirmed intake diagnostic result');
    receipts.push(result); return result;
  };
  try {
    // Resume ONLY the same operation whose native three-insert interruption and
    // blocked mixed read were already recorded before the quota stop.
    let state = await call('INSPECT'), injected = true;
    if (state.generation !== 0 || state.pending?.key !== '5a7eb83b6d6e7a1cb390c9f258b8b219'
      || state.pending.digest !== '8c8260ce8b951aa7e8704361bb4911b5' || state.pending.planHash !== '4b841011c2e29deab7ec45a1771253ad'
      || state.pending.count !== 1202 || state.pending.phase !== 'APPLY' || state.pending.cursor !== 140) throw Error('Exact saved intake checkpoint required; no automatic adoption');
    for (let round = 0; round < 190; round++) {
      const pending = state.pending || state.control?.pending;
      const step = !injected && pending?.phase === 'BEFORE' && pending.count - pending.cursor < 20 ? 'FAULT' : 'ADVANCE';
      state = await call(step);
      if (step === 'FAULT') {
        if (state.stage !== 'KNOWN_INTERRUPTION_CONFIRMED' || state.partialBusinessInserts !== 3) throw Error('Known interruption not confirmed');
        injected = true;
        if ((await call('INSPECT')).mixedReadBlocked !== true) throw Error('Partial-read barrier not confirmed');
      }
      if (state.control?.generation === 1) break;
      if (round === 189) throw Error('Intake diagnostic call bound reached');
    }
    const complete = await call('INSPECT'), replay = await call('REPLAY');
    if (!injected || complete.taskCount !== 300 || complete.orderCount !== 300 || complete.productCount !== 300
      || complete.verifiedDomainImages !== 1202 || replay.mutationAttempted !== false) throw Error('Complete intake acceptance evidence required');
    console.info('R2INTAKE_PAGE_COMPLETE ' + JSON.stringify({ receipts, realBusinessAcceptance: false, activationReady: false }));
  } catch (error) {
    console.error('R2INTAKE_PAGE_STOP ' + JSON.stringify({ error: error.message, confirmedReceipts: receipts,
      noAutomaticRetryResetOrCleanup: true }));
  }
});

// Temporary additions to the NEW unpublished R2 Capacity Test page only.
// Original capacity page and all other test gates stay CLOSED.
import { verifyPurchaseR2Authority, verifyWarehouseR2Authority } from 'backend/r2EmployeeAuthorityAcceptance.web.js';
import wixSeoFrontend from 'wix-seo-frontend';
import wixWindowFrontend from 'wix-window-frontend';
const R2_EMPLOYEE_PAGE_ENABLED=false;
$w.onReady(async function(){
 if(!R2_EMPLOYEE_PAGE_ENABLED||wixWindowFrontend.rendering.env!=='browser')return;
 try{
  await wixSeoFrontend.setTitle('R2 Employee Read Check RUNNING');
  const purchase=await verifyPurchaseR2Authority({step:'INSPECT'});
  console.info('R2EMPLOYEE_PAGE_PURCHASE '+JSON.stringify(purchase));
  if(purchase?.ok!==true||purchase.complete!==true||purchase.ordinaryStaffReadAccepted!==true||purchase.mutationAttempted!==false)throw Error('Original Purchase employee read check unconfirmed; no further test invoked');
  const warehouse=await verifyWarehouseR2Authority({step:'INSPECT'});
  console.info('R2EMPLOYEE_PAGE_WAREHOUSE '+JSON.stringify(warehouse));
  if(warehouse?.ok!==true||warehouse.complete!==true||warehouse.ordinaryStaffReadAccepted!==true||warehouse.mutationAttempted!==false)throw Error('Original Warehouse employee read check unconfirmed');
  await wixSeoFrontend.setTitle('R2 Employee Read Check PASS');
 }catch(error){wixSeoFrontend.setTitle('R2 Employee Read Check STOP').catch(()=>{});console.error('R2EMPLOYEE_PAGE_STOP '+JSON.stringify({error:error.message,noAutomaticRetryResetOrCleanup:true}));}
});

// NEW temporary acceptance addition only. Existing capacity/employee gates stay CLOSED.
import { verifyPurchaseTerminal, verifyWarehouseTerminal } from 'backend/r2EmployeeTerminalAcceptance.web.js';
import terminalWindowFrontend from 'wix-window-frontend';
import terminalSeoFrontend from 'wix-seo-frontend';
import { session as terminalSession } from 'wix-storage-frontend';
const R2_EMPLOYEE_TERMINAL_PAGE_ENABLED=false;
const TERMINAL_AUTHORITY_BUILD='03ca8d21023736f45e2526f0d503989ab29bcea6';
const TERMINAL_PROBE_SOURCE='93f04d5946b74481eff770786c958ffe53488955df15e2d3aa280bea3306ec9a';
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
