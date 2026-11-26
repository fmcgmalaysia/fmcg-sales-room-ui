import { connectWorkroomAccount } from 'public/wix-workroom-account.js';
import { runMasterQuotation } from 'backend/masterQuotation.web';
import { connectMasterQuotationFrame } from 'public/master-quotations-bridge.js';

$w.onReady(() => {
  connectMasterQuotationFrame($w('#html2'), runMasterQuotation);
  connectWorkroomAccount($w('#html2'), 'sales-management');
});