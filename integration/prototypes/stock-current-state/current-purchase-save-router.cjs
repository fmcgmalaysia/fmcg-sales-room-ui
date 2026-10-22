'use strict';
const { hash } = require('./commit-proof.cjs');
// Private original authenticated wrapper only. Browser metadata does NOT choose
// between two active writers; actual server control is the authority.
function createCurrentPurchaseSaveRouter({ company, readControl, saveCurrent, saveLegacy }) {
  if (!['NCT','GHR'].includes(company) || [readControl,saveCurrent,saveLegacy].some(fn=>typeof fn!=='function')) throw Error('Original server Purchase routing dependencies required');
  return async request => {
    const control = await readControl();
    if (!control || control._id !== hash(company,'STOCK_CONTROL') || control.company !== company
      || typeof control.stockCommitVersion !== 'string' || !control.stockCommitVersion || control.schemaVersion !== 1
      || !Number.isSafeInteger(control.generation) || control.generation < 0
      || !['LEGACY','SHADOW','MAINTENANCE','ACTIVE'].includes(control.mode)) throw Error('Purchase stock control unconfirmed. Retain the original request. 采购库存控制尚未确认，请保留原请求。');
    if (control.mode === 'LEGACY') {
      if (control.pending !== null || request.stockCurrent?.stockProtocol !== undefined) throw Error('Purchase mode changed. Refresh before saving the retained draft. 采购模式已变更，请刷新核对原草稿。');
      return saveLegacy();
    }
    if (control.mode !== 'ACTIVE') throw Error('Purchase inventory maintenance is in progress. Keep the draft. 库存维护中，请保留草稿。');
    // The commit coordinator validates exact build/generation, pending ownership,
    // original grant and all-writer coverage again under its company fence.
    // Missing/wrong metadata or an unsupported command must NEVER reach legacy.
    return saveCurrent(company,{ requestId:request.requestId,operation:request.operation,input:request.input,
      stockProtocol:request.stockCurrent?.stockProtocol,stockBuild:request.stockCurrent?.stockBuild,
      stockGeneration:request.stockCurrent?.stockGeneration,stockIdentity:request.stockCurrent?.stockIdentity });
  };
}
module.exports = { createCurrentPurchaseSaveRouter };
