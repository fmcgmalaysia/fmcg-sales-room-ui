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
    if(request.stockIdentity!==undefined&&(typeof request.stockIdentity!=='object'||request.stockIdentity===null||Array.isArray(request.stockIdentity)
      ||Object.keys(request.stockIdentity).length!==2||['staffId','memberId'].some(field=>typeof request.stockIdentity[field]!=='string'||!request.stockIdentity[field]||request.stockIdentity[field].length>200)
      ||request.stockIdentity.memberId!==actor.memberId||request.stockIdentity.staffId!==actor.staffId))throw Error('Original stock request identity required');
    // Gateways still check the ORIGINAL role/staff ID. Bind that expected identity
    // into immutable replay digest too: same login with a reissued staff ID must
    // not adopt a plan prepared under its old staff ID. This grants no authority.
    const envelope = copy({ company, writer, input: request.input, stockProtocol: request.stockProtocol,
      stockBuild: request.stockBuild, stockGeneration: request.stockGeneration,...(request.stockIdentity!==undefined?{stockIdentity:request.stockIdentity}:{}) });
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
    if (result?.ok === false && result.pending === true && result.requestId === request.requestId
      && ['BEFORE', 'APPLY', 'VERIFY'].includes(result.phase) && Number.isSafeInteger(result.completedCount)
      && Number.isSafeInteger(result.totalRecords) && result.totalRecords > 0
      && result.completedCount >= 0 && result.completedCount <= result.totalRecords) {
      return { ok: false, pending: true, requestId: request.requestId, phase: result.phase,
        completedCount: result.completedCount, totalRecords: result.totalRecords };
    }
    if (result?.ok !== true || !Number.isSafeInteger(result.generation) || result.generation < 1) throw Error('Current stock result unconfirmed');
    return { ok: true, requestId: request.requestId, stockGeneration: result.generation };
  };
}
module.exports = { createCurrentStockSave };
