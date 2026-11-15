const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('the workroom uses the same Desk and Pending names for ordinary and split assignments', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../support-room/workroom.js'), 'utf8');
  const helpers = source.slice(source.indexOf('  function deskAssignmentLabel('), source.indexOf('  function orderContent('));
  const context = vm.createContext({number: String, currentDeskInvoice: () => false, activeDesk: 0,
    line: {deskPortions: [{desk: 0, quantity: 20}, {desk: 1, quantity: 30}, {desk: 2, quantity: 10, invoiced: 10}]}});
  vm.runInContext(helpers, context);
  assert.equal(vm.runInContext('deskAssignmentLabel(1)', context), 'Desk 1');
  assert.equal(vm.runInContext('deskAssignmentLabel(0)', context), 'Pending');
  const overview = vm.runInContext('splitDeskLabel(line)', context);
  assert.match(overview, /Desk 1 · 30 CTN/);
  assert.match(overview, /desk-portion-pending">Pending · 20 CTN/);
  assert.doesNotMatch(overview, /Desk 2/);
  context.activeDesk = 1;
  context.line = {...context.line, portionDesk: 1, orderQty: 30};
  assert.equal(vm.runInContext('splitDeskLabel(line)', context), '<span class="desk-portion">Desk 1</span>');
  assert.match(source, /data-desk-task[^\n]+deskAssignmentLabel\(0\)[^\n]+deskAssignmentLabel\(desk\)/);
});
