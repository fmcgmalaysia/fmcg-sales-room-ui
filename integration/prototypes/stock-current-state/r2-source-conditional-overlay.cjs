'use strict';
// R2 compiler-only patch. Original Source modules and business payloads stay intact.
// Conditions are evaluated by the database, not a read-then-unconditional write.
module.exports = function sourceConditionalOverlay(source, target) {
  if (!['nctSalesIntake.js', 'onboarding.web.js'].includes(target)) return source;
  const once = (before, after) => {
    if (source.split(before).length !== 2) throw Error('Exact R2 Source conditional anchor changed: ' + before.slice(0, 70));
    source = source.replace(before, () => after);
  };
  source = "import { items as r2Items } from '@wix/data';\nimport { randomBytes as r2RandomBytes } from 'crypto';\n" + source;
  if (target === 'nctSalesIntake.js') {
    once("current.value.orderId !== key || current.value.customerId !== proposal.customerId)",
      "current.value.orderId !== key || current.value.customerId !== proposal.customerId || !lockedOrderEntry.r2MutationOwner || current.value.r2Owner !== lockedOrderEntry.r2MutationOwner)");
    once("const record = await wixData.update(AUDIT, { ...current.record, payload: JSON.stringify(proposal) }, { suppressAuth: true });",
      "const record = await r2Items.patch(AUDIT, current.record._id).setField('payload', JSON.stringify({ ...proposal, r2Owner: current.value.r2Owner })).run({ condition: { payload: { $eq: current.record.payload } } });");
    once("_id: lockId(key), title: lockId(key), payload: JSON.stringify(proposal)",
      "_id: lockId(key), title: lockId(key), payload: JSON.stringify({ ...proposal, r2Owner: r2RandomBytes(16).toString('hex') })");
    once("await wixData.update(AUDIT, { ...current.record, payload: JSON.stringify(proposal) }, { suppressAuth: true });",
      "await r2Items.patch(AUDIT, current.record._id).setField('payload', JSON.stringify(proposal)).run({ condition: { payload: { $eq: current.record.payload } } });");
    once("await wixData.remove(AUDIT, current.record._id, { suppressAuth: true });",
      "await r2Items.remove(AUDIT, current.record._id, { condition: { payload: { $eq: current.record.payload } } });");
    once("await putPayload(ORDERS, current.record.title, { ...current.data, status: 'SUBMITTED TO ' + body.destination,",
      "const next = { ...current.data, status: 'SUBMITTED TO ' + body.destination,");
    once("nctSubmissionBody: body, masterReceipt: receipt });",
      "nctSubmissionBody: body, masterReceipt: receipt };\n      await r2Items.patch(ORDERS, current.record._id)\n        .setField('title', text(current.record.title)).setField('payload', JSON.stringify(next))\n        .setField('customerId', text(next.customerId)).setField('orderId', text(next.orderId))\n        .setField('orderSortKey', text(next.confirmedAt) + '|' + text(next.orderId))\n        .setField('status', text(next.status).toUpperCase()).setField('isComplete', Boolean(next.isComplete))\n        .run({ condition: { payload: { $eq: current.record.payload } } });");
  } else {
    once("  const lockId = 'ORDER-LOCK-' + id;", "  const lockId = 'ORDER-LOCK-' + id, r2MutationOwner = r2RandomBytes(16).toString('hex');");
    once("action: 'ORDER_MUTATION_LOCK', orderId: id, customerId: initial.data.customerId, at: new Date().toISOString()",
      "action: 'ORDER_MUTATION_LOCK', orderId: id, customerId: initial.data.customerId, at: new Date().toISOString(), r2Owner: r2MutationOwner");
    once("return await action({ record, data: payloadData(record) });", "return await action({ record, data: payloadData(record), r2MutationOwner });");
    once("    if (release) await wixData.remove(BUYER_ORDER_AUDIT_COLLECTION, lockId, { suppressAuth: true });", `    if (release) {
      const page = await wixData.query(BUYER_ORDER_AUDIT_COLLECTION).eq('_id', lockId).limit(2).find({ suppressAuth: true, consistentRead: true });
      if (!Array.isArray(page.items) || page.items.length > 1) throw Error('Exact R2 order lock read required');
      const held = page.items[0];
      if (held && payloadData(held)?.r2Owner === r2MutationOwner) {
        await r2Items.remove(BUYER_ORDER_AUDIT_COLLECTION, lockId, { condition: { payload: { $eq: held.payload } } });
      }
    }`);
  }
  return source;
};
