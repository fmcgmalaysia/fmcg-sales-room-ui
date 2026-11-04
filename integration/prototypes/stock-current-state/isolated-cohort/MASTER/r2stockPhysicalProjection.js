// Read-only candidate. Financial settlement is not evidence of physical removal.
// The caller supplies the existing stockPosition result; no second movement ledger.
export function projectPhysicalStock(stock) {
  const qty = value => Number.isSafeInteger(value) && value >= 0;
  if (!stock || !qty(stock.availablePhysical) || !Array.isArray(stock.cases)) {
    throw Error('Physical stock requires a verified source position.');
  }
  let isolated = 0, returned = 0;
  const issues = [];
  for (const item of stock.cases) {
    if (!qty(item.quantity)) throw Error('Physical stock case quantity requires review.');
    const movements = item.resolution?.returns || [];
    if (!Array.isArray(movements) || movements.some(row => !qty(row.quantity))) {
      throw Error('Physical stock return quantity requires review.');
    }
    const sentBack = movements.reduce((sum, row) => sum + row.quantity, 0);
    if (sentBack > item.quantity) throw Error('Physical returns exceed the isolated quantity.');
    returned += sentBack;
    const outcome = item.resolution?.financeApproval?.outcome;
    if (outcome === 'RELEASED') {
      if (sentBack) throw Error('Released stock cannot also be a supplier return.');
      continue;
    }
    const remaining = item.quantity - sentBack;
    isolated += remaining;
    // Current legacy cases have no physical-disposal record. A closed case with
    // goods not returned may still be physically present, or may have been removed.
    if (outcome && remaining) issues.push('SETTLED_GOODS_LOCATION_REQUIRES_REVIEW');
  }
  return {
    usableOnHand: stock.availablePhysical,
    isolated: issues.length ? null : isolated,
    onHand: issues.length ? null : stock.availablePhysical + isolated,
    returned,
    issues: [...new Set(issues)]
  };
}
