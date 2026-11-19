// NEW fixed ordinary-employee acceptance only; old diagnostic gates stay CLOSED.
import { verifyPurchaseWorkflow } from 'backend/r2PurchaseFlowAcceptance.web.js';
import purchaseFlowLocation from 'wix-location-frontend';
import purchaseFlowWindow from 'wix-window-frontend';
import purchaseFlowSeo from 'wix-seo-frontend';
import { session as purchaseFlowSession } from 'wix-storage-frontend';
const R2_PURCHASE_FLOW_PAGE_ENABLED=false;
const PURCHASE_FLOW_ACCEPTANCE_BUILD='__PURCHASE_FLOW_ACCEPTANCE_BUILD__';
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
