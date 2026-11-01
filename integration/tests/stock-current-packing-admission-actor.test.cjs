'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createCurrentPackingService } = require('../prototypes/stock-current-state/current-packing-service.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function extract(file, expression) {
  const filename = require.resolve('./' + file), source = fs.readFileSync(filename, 'utf8').replace(/const test\s*=\s*require\('node:test'\)/, 'const test = () => {}');
  return vm.runInNewContext(source + '\n' + expression, { require: createRequire(filename), Map, Buffer });
}
const base = extract('stock-current-packing-service-v2.test.cjs', 'fixture;');
const photos = extract('stock-current-packing-photo.test.cjs', '({fixture,photo});');
function driftingService(f, employees, admittedReads) {
  let reads = 0, contexts = 0;
  const readContext = f.deps.readContext;
  const deps = { ...f.deps, readContext: async (...args) => { contexts++; return readContext(...args); },
    readStaffRecords: async () => { reads++; return employees.map(row => ({ ...row, title: reads <= admittedReads ? row.title : 'REISSUED' })); } };
  return { service: createCurrentPackingService({ company: 'NCT', items: deps.items, store: f.store, protocol: f.protocol,
    coverage: Object.fromEntries(WRITERS.map(w => [w, { verified: true, build: 'TEST' }])), authorityDependencies: deps }),
    reads: () => reads, contexts: () => contexts };
}

test('photo preparation identity drift refuses before file-ID allocation, not merely before manifest publication', async () => {
  const f = await photos.fixture(), request = await f.command('WAREHOUSE', 'PHOTOS', {
    taskId: 'T', photoStage: 'LOADING', photos: [photos.photo()] });
  const before = JSON.stringify([...f.db]), stableRequest = JSON.stringify(request);
  const h = driftingService(f, copy(await f.deps.readStaffRecords()), 2);
  await assert.rejects(h.service.save(request), /packing employee changed during preparation/);
  assert.equal(h.reads(), 3);
  assert.equal(f.allocated.length, 0, 'A wrong original employee must not allocate otherwise unused file IDs');
  assert.equal(f.commands.length, 0); assert.equal(h.contexts(), 0);
  assert.ok(JSON.stringify([...f.db]) === before); assert.equal(JSON.stringify(request), stableRequest);
});

for (const department of ['SUPPORT', 'WAREHOUSE']) test(`${department} packing save rejects changed employee before private context while retaining same list/stock`, async () => {
  const f = department === 'SUPPORT' ? await base() : await photos.fixture();
  let request;
  if (department === 'SUPPORT') {
    const read = await f.service.read({ department });
    request = { department, requestId: f.request.requestId, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
      stockIdentity: { memberId: 'M', staffId: 'S' }, input: { action: 'SEND', id: 'LIST', revision: 'REV0', version: read.version } };
  } else request = await f.command(department, 'PROGRESS', { lines: [{ taskId: 'T', packed: 50, loaded: 42, reason: 'Container full' }] });
  const before = JSON.stringify([...f.db]), h = driftingService(f, copy(await f.deps.readStaffRecords()), 1);
  await assert.rejects(h.service.save(request), /packing employee changed during preparation/);
  assert.equal(h.reads(), 2); assert.equal(h.contexts(), 0);
  assert.ok(JSON.stringify([...f.db]) === before);
});
