'use strict';

const { evaluateStockAdmission, WRITERS } = require('./stock-admission.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// Server composition boundary. Does not grant roles, verify coverage or implement a
// legacy fallback. Real gateway supplies original department auth and its exact plan.
// Default empty coverage deliberately keeps activation OFF until all writers verified.
function createCurrentStockSave({ company, writer, authenticate, protocol, prepare, coverage = {} }) {
  if (!['NCT', 'GHR'].includes(company) || !WRITERS.includes(writer) || typeof authenticate !== 'function'
    || typeof protocol?.commit !== 'function' || typeof prepare !== 'function') throw Error('Server current-save dependencies required');
  return async request => {
    if (!request || !/^[a-f0-9-]{36}$/i.test(request.requestId || '') || !request.input || typeof request.input !== 'object'
      || Array.isArray(request.input)) throw Error('Valid current stock request required');
    // Reauthorize even if the exact request has already completed. No browser actor,
    // approval, coverage, resume or route field enters the privileged callbacks.
    const actor = await authenticate(company);
    if (typeof actor?.memberId !== 'string' || !actor.memberId) throw Error('Authenticated department member required');
    const envelope = copy({ company, writer, input: request.input, stockProtocol: request.stockProtocol,
      stockBuild: request.stockBuild, stockGeneration: request.stockGeneration });
    let admittedGeneration;
    const result = await protocol.commit({ requestId: request.requestId, memberId: actor.memberId, input: envelope,
      authorize: operation => {
        const admission = evaluateStockAdmission({ company, writer, control: operation.control, coverage, request: envelope, operation });
        if (admission.route !== 'FENCED_CURRENT') throw Error('Current save requires ACTIVE mode; no legacy or shadow fallback');
        admittedGeneration = admission.generation;
      },
      prepare: async () => {
        const prepared = await prepare({ company, requestId: request.requestId, memberId: actor.memberId, input: copy(envelope.input) });
        if (prepared?.memberId !== actor.memberId || prepared.generation !== admittedGeneration || !prepared.plan) throw Error('Prepared authority/generation changed');
        return prepared.plan;
      } });
    if (result?.ok !== true || !Number.isSafeInteger(result.generation) || result.generation < 1) throw Error('Current stock result unconfirmed');
    return { ok: true, requestId: request.requestId, stockGeneration: result.generation };
  };
}
module.exports = { createCurrentStockSave };
