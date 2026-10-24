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
