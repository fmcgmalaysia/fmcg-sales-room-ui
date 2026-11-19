const KEY = /^[A-Za-z0-9_-]{1,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['customers', 'quotes', 'cost', 'cost-status', 'draft', 'publish']);

function editInput(action, input) {
  if (!input || typeof input.selectionId !== 'string' || !KEY.test(input.selectionId) ||
      !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      typeof input.requestId !== 'string' || !UUID.test(input.requestId)) return null;

  const write = { selectionId: input.selectionId, revision: input.revision, requestId: input.requestId };
  if (action === 'publish') return typeof input.enabled === 'boolean' ? { ...write, enabled: input.enabled } : null;
  const fields = input.input;
  if (!fields || !['EA', 'GP'].includes(fields.mode) || !Number.isFinite(fields.value)) return null;
  return { ...write, input: { mode: fields.mode, value: fields.value } };
}

// Use this only on the dedicated Quotations component, with the page's server
// action. The server action must independently check staff and customer access.
export function connectMasterQuotationFrame(frame, run) {
  frame.onMessage(async ({ data }) => {
    if (data?.type !== 'MASTER_QUOTATION_REQUEST' ||
        typeof data.requestId !== 'string' || !UUID.test(data.requestId) || !ACTIONS.has(data.action) ||
        typeof data.customerId !== 'string' ||
        (data.action === 'customers' ? data.customerId !== '' : !KEY.test(data.customerId))) return;

    const { requestId, customerId, action } = data;
    const envelope = { type: 'MASTER_QUOTATION_RESULT', requestId, customerId, action };
    const editing = action === 'draft' || action === 'publish';
    const costRead = action === 'cost' || action === 'cost-status';
    const input = editing ? editInput(action, data.input) : costRead && UUID.test(data.input?.requestId || '') ? { requestId: data.input.requestId } : undefined;
    if ((editing || costRead) && !input) {
      frame.postMessage({ ...envelope, ok: false, error: 'Review the quotation inputs and try again.' });
      return;
    }
    try {
      const result = await run(action, customerId, input);
      if (result?.accessDenied === true) {
        frame.postMessage({ ...envelope, ok: false, accessDenied: true, error: 'Your staff access could not be confirmed.' });
        return;
      }
      frame.postMessage({ ...envelope, ok: true, result });
    } catch (error) {
      if (costRead) {
        const code = String(error?.code || '');
        console.warn('MASTER_QUOTATION_COST_CONFIRMING', requestId,
          /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'UNCONFIRMED');
        frame.postMessage({ ...envelope, ok: true, result: { pending: true } });
        return;
      }
      frame.postMessage({ ...envelope, ok: false, error: 'The quotation action could not be confirmed.' });
    }
  });
}
