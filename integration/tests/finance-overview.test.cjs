const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ageBalances, receivableReport, payableReport } = require('../../account-room/finance-overview.js');

const today = '2026-11-15';

test('age by due date, include today and the following six days, and keep undated items separate', () => {
  const rows = [
    { balance: 100, dueDate: '2026-11-15' },
    { balance: 200, dueDate: '2026-11-21' },
    { balance: 300, dueDate: '2026-11-22' },
    { balance: 400, dueDate: '2026-10-16' },
    { balance: 500, dueDate: '2026-10-15' },
    { balance: 600, dueDate: '2026-08-17' },
    { balance: 700, dueDate: '2026-08-16' },
    { balance: 800, dueDate: '2026-02-30' },
    { balance: 0 },
    { balance: -500 },
  ];
  assert.deepEqual(ageBalances(rows, today), {
    total: 3600, aging: [600, 400, 500, 600, 700], unknown: 800, nextSeven: 300, overdue: 2200, complete: false,
  });
});

test('invoice balances already reflect allocations and do not mix currencies', () => {
  const ledger = { invoicePayments: { invoices: [
    { currency: 'USD', dueCents: 1000, amountCents: 12000 },
    { currency: 'USD', dueCents: 400, dueDate: '2026-11-01', kind: 'DEBIT_NOTE' },
    { currency: 'SGD', dueCents: 2000, dueDate: '2026-11-16' },
    { currency: 'USD', dueCents: 0, amountCents: 10000 },
  ] } };
  assert.deepEqual(receivableReport(ledger, 'USD', today), {
    total: 1400, aging: [0, 400, 0, 0, 0], unknown: 1000, nextSeven: 0, overdue: 400, complete: false,
  });
  assert.equal(receivableReport(ledger, 'SGD', today).nextSeven, 2000);
});

test('supplier forecasts include confirmed payable balances and count awaiting invoices separately', () => {
  const snapshot = { orders: [
    { currency: 'MYR', dueDate: '2026-11-01', finance: { payableCents: 3900, balanceCents: 100 } },
    { currency: 'MYR', finance: { payableCents: 5000, balanceCents: -20 } },
    { currency: 'MYR', finance: { payableCents: null }, documents: [{ type: 'INV', linked: true }] },
    { currency: 'MYR', finance: { payableCents: null }, documents: [{ type: 'PI', linked: true }] },
  ] };
  assert.equal(payableReport(snapshot, 'MYR', today).overdue, 100);
  assert.equal(payableReport(snapshot, 'MYR', today).pendingInvoices, 1);
  assert.equal(payableReport({ ...snapshot, queryView: 'SUPPLIER_ACTIVE' }, 'MYR', today), null);
});

test('an unavailable ledger or invalid balance is distinct from an empty ledger', () => {
  assert.equal(receivableReport({}, 'USD', today), null);
  assert.equal(ageBalances([{ balance: undefined }], today), null);
  assert.equal(ageBalances([], today).total, 0);
  assert.equal(payableReport({ orders: [
    { currency: 'MYR', finance: { payableCents: 3920, balanceCents: null } },
  ] }, 'MYR', today), null);
});
