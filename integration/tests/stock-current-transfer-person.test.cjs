const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { transferPerson } = require('../prototypes/stock-current-state/transfer-person.cjs');
const relation = { id: 'R1', borrowerTaskId: 'A', lenderTaskId: 'B', quantity: 30, repaid: 0 };
test('both borrowing parties have halo until the final outstanding relationship ends', () => {
  for (const taskId of ['A', 'B']) {
    assert.equal(transferPerson({ taskId, relations: [relation] }).halo, true);
    assert.equal(transferPerson({ taskId, relations: [{ ...relation, repaid: 29 }] }).halo, true);
    assert.equal(transferPerson({ taskId, relations: [{ ...relation, repaid: 30 }] }).halo, false);
  }
  assert.equal(transferPerson({ taskId: 'C', relations: [relation] }).halo, false);
  assert.equal(transferPerson({ taskId: 'A', relations: [{ ...relation, repaid: 30 }, { ...relation, id: 'R2' }] }).halo, true);
});
test('preserves actual existing body paths and inherits original colour without triangle', () => {
  for (const [variant, file] of [['TASK_GRID', 'task-grid.js'], ['ALLOCATION', 'supplier-allocation.js']]) {
    const plain = transferPerson({ taskId: 'A', relations: [], variant }).svg;
    const body = plain.match(/<circle[\s\S]*<\/svg>/)[0].replace('</svg>', '');
    assert.ok(fs.readFileSync(path.join(__dirname, '../../purchase-live', file), 'utf8').includes(body));
    const decorated = transferPerson({ taskId: 'A', relations: [relation], variant }).svg;
    assert.ok(decorated.includes(body)); assert.ok(decorated.includes('<ellipse'));
    assert.ok(decorated.includes('stroke="currentColor"')); assert.equal(decorated.includes('<polygon'), false);
    assert.equal(decorated.includes('#'), false);
  }
});
test('unknown repayment quantity cannot silently remove the halo', () => {
  assert.throws(() => transferPerson({ taskId: 'A', relations: [{ ...relation, repaid: null }] }), /known quantities/);
});
test('approved unused return closes halo without claiming receipt, corrected repayment restores halo', () => {
  assert.equal(transferPerson({ taskId: 'A', relations: [{ ...relation, returned: 30 }] }).halo, false);
  assert.equal(transferPerson({ taskId: 'A', relations: [{ ...relation, repaid: 20 }] }).halo, true);
});
