import { runMasterQuotation } from 'backend/masterQuotation.web';
import { connectMasterQuotationFrame } from 'public/master-quotations-bridge.js';

$w.onReady(() => {
  connectMasterQuotationFrame($w('#html1'), runMasterQuotation);
});
