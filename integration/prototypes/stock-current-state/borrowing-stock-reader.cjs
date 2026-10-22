'use strict';

// Bounded current-row preparation candidate. Authority callback is SERVER-owned and
// must retain existing permission/PO/packing/finance checks. No production imports.
const { readCurrentProduct } = require('./current-product-reader.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { prepareBorrowApproval, prepareBorrowReturn, prepareBorrowingReceipt, prepareCurrentAllocation } = require('./borrowing-stock-plan.cjs');
function createBorrowingStockReader({ company, items, store, protocol, readAuthority }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || typeof protocol?.readSnapshot !== 'function' || typeof readAuthority !== 'function') throw Error('Server borrowing dependencies required');
  return async () => {
    const metrics = { exactReads: 0, queries: 0 };
    const snapshot = await protocol.readSnapshot(async control => {
      const authority = await readAuthority();
      const identity = authority?.identity || authority?.state;
      if (!identity || identity.company !== company || !['APPROVE', 'RETURN', 'RECEIVE', 'ALLOCATE'].includes(authority.kind)
        || !authority.state && typeof authority.buildState !== 'function') throw Error('Verified borrowing authority required');
      if (protocol.planFormat === 'SEGMENTED_V2' && (!authority.stockScope || authority.state)) throw Error('Server borrowing current scope required');
      const rows = protocol.planFormat === 'SEGMENTED_V2'
        ? await readScopedCurrentProduct({ ...authority.stockScope, company, identity, items, store, metrics, transferIndexVersion: control?.transferIndexVersion })
        : await readCurrentProduct({ company, identity, items, store, metrics });
      if (protocol.planFormat === 'SEGMENTED_V2') {
        if (typeof authority.readTaskRows !== 'function') throw Error('Private current task checkpoint reader required');
        rows.taskRows = await authority.readTaskRows(rows); rows.generation = control.generation;
      }
      if (typeof authority.buildState === 'function') authority.state = authority.buildState(rows);
      return { authority, rows };
    });
    const { authority, rows } = snapshot.rows;
    const args = { state: authority.state, rows, event: authority.event, generation: snapshot.generation };
    const result = authority.kind === 'ALLOCATE' ? prepareCurrentAllocation(args) : authority.kind === 'RECEIVE' ? prepareBorrowingReceipt(args)
      : (authority.kind === 'APPROVE' ? prepareBorrowApproval : prepareBorrowReturn)({ ...args, input: authority.input });
    return { ...result, memberId: authority.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { createBorrowingStockReader };
