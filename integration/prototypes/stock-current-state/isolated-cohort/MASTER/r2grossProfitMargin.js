// Backend-only arithmetic. Caller must supply the current Admin FX before invoice,
// or the immutable financial snapshot saved by the customer invoice transaction.
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function calculateGrossProfitMargin({ sellingPricePc, eaPerCtn, netCostCtn, rateToMyr }) {
  if (!finite(sellingPricePc) || sellingPricePc <= 0 ||
      !Number.isSafeInteger(eaPerCtn) || eaPerCtn <= 0 ||
      !finite(netCostCtn) || netCostCtn < 0 || !finite(rateToMyr) || rateToMyr <= 0) return null;
  const sellingCtnMyr = sellingPricePc * eaPerCtn * rateToMyr;
  if (!finite(sellingCtnMyr) || sellingCtnMyr <= 0) return null;
  const margin = (sellingCtnMyr - netCostCtn) / sellingCtnMyr;
  return finite(margin) ? margin : null;
}

export function calculateNetCartonCost({ lpCtn, disc1, disc2, disc3 }) {
  if (![lpCtn, disc1, disc2, disc3].every(finite) || lpCtn < 0 || disc3 < 0 ||
      disc1 < 0 || disc1 > 1 || disc2 < 0 || disc2 > 1) return null;
  const cost = lpCtn * (1 - disc1) * (1 - disc2) - disc3;
  return finite(cost) && cost >= 0 ? cost : null;
}
