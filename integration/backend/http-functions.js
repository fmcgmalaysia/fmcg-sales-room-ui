// Candidate for the Master site only. Existing source-site http-functions.js must remain untouched.
import { response } from 'wix-http-functions';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';
import { createNctReceiver } from 'backend/nctReceiver.js';

const COST_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzpMXT1ap2sOXRUkCAXx3BomPQK0E-0oTp6g3tna3Rs7cGHGRU0W2qRtwnU9YcC94qv/exec';
const store = {
  async read(collection, id) {
    const result = await wixData.query(collection).eq('_id', id).limit(2).find({ suppressAuth: true, consistentRead: true });
    if (result.items.length > 1) throw new Error('Ambiguous Master record');
    return result.items[0] || null;
  },
  async insert(collection, row) { return wixData.insert(collection, row, { suppressAuth: true }); }
};
const handle = createNctReceiver({
  store,
  getIntakeSecret: () => getSecret('MASTER_INTAKE_SHARED_SECRET'),
  async captureCosts(barcodes) {
    const sharedSecret = await getSecret('FMCG_QD_ROUTER_TOKEN');
    if (!sharedSecret) throw new Error('Cost service is not configured');
    // Do not call until the new authenticated router action is installed and deployed.
    const result = await fetch(COST_ENDPOINT, {
      method: 'post', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'MASTER_CAPTURE_COST', sharedSecret, barcodes })
    });
    if (!result.ok) throw new Error('Cost service unavailable');
    const payload = await result.json();
    if (payload?.ok !== true || payload?.result?.kind !== 'MASTER_POINTBASE_COST_V1' || !payload.result.costs) throw new Error('Cost service response is not a verified cost result');
    return payload.result.costs;
  }
});

export async function post_nctIntake(request) {
  const result = await handle(request);
  return response({ status: result.status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store'
  }, body: JSON.stringify(result.body) });
}
