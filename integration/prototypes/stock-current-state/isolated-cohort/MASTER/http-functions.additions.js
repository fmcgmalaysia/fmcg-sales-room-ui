import { createNctReceiver as createR2NctReceiver } from 'backend/r2nctReceiver.js';
import { handleSalesFulfilment as handleR2SalesFulfilment } from 'backend/r2customerFulfilmentGateway.js';
import { readPurchaseQuantities as readR2PurchaseQuantities } from 'backend/r2purchaseQuantityRead.js';
const handleR2Intake = createR2NctReceiver({ store, getIntakeSecret: () => getSecret('MASTER_INTAKE_SHARED_SECRET'), captureCosts: capturePointbaseCosts });
const r2Response = result => response({ status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(result.body) });
async function r2Ingress(request, handler) { const keys = Object.keys(request.headers || {}).filter(key => key.toLowerCase() === 'x-fmcg-cohort'); if (keys.length !== 1 || request.headers[keys[0]] !== 'MASTER_20261024_R2') return r2Response({ status: 409, body: { ok: false, error: 'Order program changed. Refresh the original order; no new receipt was created.' } }); return r2Response(await handler(request)); }
export async function post_r2NctIntake(request) { return r2Ingress(request, handleR2Intake); }
export async function post_r2SalesFulfilment(request) { return r2Ingress(request, handleR2SalesFulfilment); }
export async function post_r2PurchaseQuantities(request) { return r2Ingress(request, readR2PurchaseQuantities); }
