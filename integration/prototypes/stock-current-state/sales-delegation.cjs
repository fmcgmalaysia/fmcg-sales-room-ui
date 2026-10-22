'use strict';
// Shape/scope assertion only, NOT authentication. Original shared-secret gateway
// must create this staff object AFTER authorizing the source request.
function requireOriginalSalesDelegation(staff, customerId) {
  if (typeof staff?.staffId !== 'string' || !staff.staffId || staff.staffId.length > 100
    || staff.memberId !== 'SOURCE_SALES/' + staff.staffId || typeof staff.staffName !== 'string' || !staff.staffName || staff.staffName.length > 200
    || staff.canSelectShipment !== true || typeof staff.customerId !== 'string' || !staff.customerId || staff.customerId.length > 100
    || customerId !== staff.customerId) throw Error('Original authenticated Sales customer delegation required');
  return staff;
}
module.exports = { requireOriginalSalesDelegation };
