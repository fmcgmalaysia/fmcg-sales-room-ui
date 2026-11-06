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

// NEW fixed ordinary-employee acceptance only; old diagnostic gates stay CLOSED.
import { verifyPurchaseWorkflow } from 'backend/r2PurchaseFlowAcceptance.web.js';
import purchaseFlowLocation from 'wix-location-frontend';
import purchaseFlowWindow from 'wix-window-frontend';
import purchaseFlowSeo from 'wix-seo-frontend';
import { session as purchaseFlowSession } from 'wix-storage-frontend';
const R2_PURCHASE_FLOW_PAGE_ENABLED=false;
const PURCHASE_FLOW_ACCEPTANCE_BUILD='b1d3dcf828d848b6c25d0eaab90a7b50666a12a5';
$w.onReady(async function(){
 if(!R2_PURCHASE_FLOW_PAGE_ENABLED||purchaseFlowWindow.rendering.env!=='browser'
   ||purchaseFlowLocation.query.r2PurchaseFlow!=='20261025-a479')return;
 const key=step=>'R2_PURCHASE_FLOW_A479_'+step;
 async function call(step){
  const result=await verifyPurchaseWorkflow({step});
  if(result?.schema!=='R2_PURCHASE_WORKFLOW_ACCEPTANCE_V1'||result.fixture!=='PURCHASEFLOW-20261025-a479'
    ||result.acceptanceBuild!==PURCHASE_FLOW_ACCEPTANCE_BUILD||result.step!==step||result.ok!==true
    ||result.activationAllowed!==false||result.writerCoverageAccepted!==false||result.pairedSourceTransportAccepted!==false
    ||result.originalBusinessCollectionsAccepted!==false||result.realInvoiceEnabled!==false||result.physicalDispatchEnabled!==false)throw Error('Paired fixed Purchase workflow result unconfirmed');
  console.info('R2_PURCHASE_WORKFLOW_PAGE_RECEIPT '+JSON.stringify(result));return result;
 }
 async function attempted(step){
  if(purchaseFlowSession.getItem(key(step))==='INFLIGHT')throw Error('Uncertain earlier workflow call retained; inspect only');
  purchaseFlowSession.setItem(key(step),'INFLIGHT');
  if(purchaseFlowSession.getItem(key(step))!=='INFLIGHT')throw Error('Workflow session guard unconfirmed');
  const result=await call(step);
  purchaseFlowSession.setItem(key(step),result.result?.pending===true?'PENDING':'COMPLETE');return result;
 }
 try{
  await purchaseFlowSeo.setTitle('R2 Purchase Workflow RUNNING');
  let state=await call('INSPECT');
  if(state.stage==='EMPTY_FIXED_WORKFLOW'){
   if(purchaseFlowSession.getItem(key('SEED')))throw Error('Earlier seed attempt retained; no reseed');
   await attempted('SEED');state=await call('INSPECT');
  }
  for(const step of ['INTAKE','PLAN','PO']){
   if(state.complete===true)break;
   const target={INTAKE:0,PLAN:1,PO:2}[step];
   if(state.generation>target)continue;
   if(state.nextStep!==step||state.generation!==target)throw Error('Unexpected retained workflow stage');
   let completed=false,last=null,unchanged=0,total=null;
   for(let count=0;count<40;count++){
    const reply=await attempted(step),result=reply.result;
    if(result?.ok===true&&result.pending!==true){completed=true;break;}
    if(result?.ok!==false||result.pending!==true||!['BEFORE','APPLY','VERIFY'].includes(result.phase)
      ||!Number.isSafeInteger(result.completedCount)||!Number.isSafeInteger(result.totalRecords)
      ||result.totalRecords<1||result.totalRecords>100||result.completedCount<0||result.completedCount>result.totalRecords
      ||total!==null&&total!==result.totalRecords)throw Error('Fixed workflow continuation unconfirmed');
    total=result.totalRecords;
    const rank=['BEFORE','APPLY','VERIFY'].indexOf(result.phase),progress=[rank,result.completedCount];
    if(last&&(rank<last[0]||rank===last[0]&&progress[1]<last[1]))throw Error('Workflow progress regressed');
    unchanged=last&&rank===last[0]&&progress[1]===last[1]?unchanged+1:0;
    if(unchanged>=3)throw Error('Workflow progress stopped; retained request requires inspection');
    last=progress;
   }
   if(!completed)throw Error('Fixed workflow budget reached; retained request not reset');
   state=await call('INSPECT');
  }
  if(state.complete!==true||state.stage!=='PURCHASE_WORKFLOW_VERIFIED'||state.generation!==3||state.pending!==null
    ||state.customerDemand!==100||state.purchaseQuantity!==90||state.physicalStock!==0||state.taskCount!==1||state.orderCount!==1)throw Error('Final Purchase workflow facts unconfirmed');
  await purchaseFlowSeo.setTitle('R2 Purchase Workflow PASS');
 }catch(error){
  purchaseFlowSeo.setTitle('R2 Purchase Workflow STOP').catch(()=>{});
  console.error('R2_PURCHASE_WORKFLOW_PAGE_STOP '+JSON.stringify({error:error.message,noAutomaticRetryResetOrCleanup:true}));
 }
});
