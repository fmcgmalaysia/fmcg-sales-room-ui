const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const patch = require('../releases/warehouse-unchanged-refresh.cjs');
const original = require('../releases/support-warehouse-desk-sync.json').changes['master-shared/desk-delivery.js'].source;

function fixture(source) {
  const start = source.indexOf('  async function refresh(');
  const end = source.indexOf('  function modal(', start);
  assert.ok(start >= 0 && end > start);
  let reads = 0, renders = 0, error = '', busy = false, date = '2026-11-15', resolve;
  const lists = [{ id: 'D1', desk: { number: 1 }, lines: [{ taskId: 'A', loaded: 0 }, { taskId: 'B', loaded: 0 }] }];
  const reply = { company: 'NCT', deskDeliveryVersion: 2, lists, completedLists: [], staff: { staffName: 'LAW' } };
  const state = { company: 'NCT', generation: 0, reading: false, loaded: true, refreshDay: date,
    lists: structuredClone(lists), completedLists: [], staff: 'LAW', notice: '' };
  const scope = { state, activePage: () => true, busy: () => busy, document: { hidden: false },
    Date: class { toLocaleDateString() { return date; } }, render: () => renders++,
    sender: async () => { reads++; if (error) throw Error(error); return structuredClone(reply); } };
  const refresh = vm.runInNewContext(source.slice(start, end) + ';refresh', scope);
  return { refresh, reply, state, counts: () => ({ reads, renders }), setError: value => { error = value; },
    setDay: value => { date = value; }, setBusy: value => { busy = value; },
    delay() { scope.sender = () => new Promise(done => { reads++; resolve = done; }); },
    finish() { resolve(structuredClone(reply)); } };
}

test('six identical reads keep the live table instead of replacing it six times', async () => {
  const before = fixture(original), after = fixture(patch(original));
  for (let index = 0; index < 6; index++) {
    before.reply.readAt = after.reply.readAt = String(index);
    await before.refresh();
    await after.refresh();
  }
  assert.deepEqual(before.counts(), { reads: 6, renders: 6 });
  assert.deepEqual(after.counts(), { reads: 6, renders: 0 });
});

test('new Loaded counts, row order, errors, recovery and local midnight still render', async () => {
  const f = fixture(patch(original));
  f.reply.lists[0].lines[0].loaded = 2;
  await f.refresh();
  assert.equal(f.state.lists[0].lines[0].loaded, 2);
  f.reply.lists[0].lines.reverse();
  await f.refresh();
  assert.equal(f.state.lists[0].lines[0].taskId, 'B');
  f.setError('temporarily offline');
  await f.refresh();
  await f.refresh();
  assert.equal(f.state.notice, 'temporarily offline');
  assert.equal(f.counts().renders, 3);
  f.setError('');
  await f.refresh();
  assert.equal(f.state.notice, '');
  f.setDay('2026-11-16');
  await f.refresh();
  await f.refresh(true);
  assert.deepEqual(f.counts(), { reads: 7, renders: 6 });
});

test('a dialog opened during refresh preserves its current table and permits the next refresh', async () => {
  const f = fixture(patch(original));
  f.delay();
  f.reply.lists[0].lines[0].loaded = 2;
  const pending = f.refresh();
  f.setBusy(true);
  f.finish();
  await pending;
  assert.equal(f.state.lists[0].lines[0].loaded, 0);
  assert.equal(f.state.reading, false);
  f.setBusy(false);
  const next = f.refresh();
  f.finish();
  await next;
  assert.equal(f.state.lists[0].lines[0].loaded, 2);
  assert.deepEqual(f.counts(), { reads: 2, renders: 1 });
});
