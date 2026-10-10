// Candidate for the Master site only. Existing source-site http-functions.js must remain untouched.
import { response } from 'wix-http-functions';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { capturePointbaseCosts } from 'backend/pointbaseCostClient.js';
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
    return capturePointbaseCosts(barcodes);
  }
});

export async function post_nctIntake(request) {
  const result = await handle(request);
  return response({ status: result.status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store'
  }, body: JSON.stringify(result.body) });
}
