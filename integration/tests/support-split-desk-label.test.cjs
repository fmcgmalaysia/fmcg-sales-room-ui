const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { patchScript } = require('../releases/stage-support-desk-label.cjs');

function deskLabel(line, invoice = false) {
  const markers = [
    '  function orderContent(order){',
    "unassignedRemainder=line.deskPortions?.some(part=>part.desk===0&&part.quantity>0)&&!line.deskPortions.some(part=>part.desk>0&&part.quantity>(part.invoiced||0)),",
    "class=\"'+(unassignedRemainder?'unassigned':'')+'\"",
    "aria-label=\"'+(unassignedRemainder?'Arrange Desk 待安排':'Split shipment 分批出货')+'\"",
    "+(unassignedRemainder?'—':'Split…')+",
  ];
  const patched = patchScript(markers.join('\n'));
  const helper = patched.slice(0, patched.indexOf(markers[0]));
  return vm.runInNewContext(helper + 'splitDeskLabel(line)', {
    line, number: String, activeDesk: 1, currentDeskInvoice: () => invoice,
  });
}

test('split shows the retained Desk and the pending portion once', () => {
  const markup = deskLabel({deskPortions: [{desk: 1, quantity: 50}, {desk: 0, quantity: 20}]});
  assert.match(markup, /Desk 1 · 50/);
  assert.match(markup, /desk-portion-pending">Pending · 20/);
  assert.doesNotMatch(markup, /Split/);
});

test('specific Desk view only shows its current portion', () => {
  const markup = deskLabel({portionDesk: 1, orderQty: 50, deskPortions: [{desk: 0, quantity: 20}]});
  assert.match(markup, /Desk 1 · 50/);
  assert.doesNotMatch(markup, /Pending/);
});

test('completed portions disappear from the active summary and issued view retains its own quantity', () => {
  const line = {orderQty: 50, deskPortions: [{desk: 1, quantity: 50, invoiced: 50}, {desk: 0, quantity: 20}]};
  assert.doesNotMatch(deskLabel(line), /Desk 1/);
  assert.match(deskLabel(line), /Pending · 20/);
  assert.match(deskLabel(line, true), /Desk 1 · 50/);
});
