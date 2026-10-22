const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '../prototypes/stock-current-state');
const source = fs.readFileSync(path.join(root, 'purchase-ui/app.js'), 'utf8');
test('Purchase progress overlay is an exact narrow transformation of original app', () => {
  assert.match(execFileSync(process.execPath, [path.join(root, 'build-purchase-current-ui.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  new vm.Script(source);
  assert.ok(source.includes('sessionStorage.setItem(draftKey,'), 'original draft cache, including full pending request, retained');
  assert.equal(source.includes('localStorage.setItem'), false);
});
function fixture(current = true) {
  let handler, finished = 0, continued = 0, cached = 0;
  const timers = [], parent = {}, request = { type: 'PURCHASE_SAVE_REQUEST', company: 'NCT', requestId: 'SAME-UUID', operation: 'PLAN',
    input: { taskId: 'T', totalCtn: 50 }, ...(current ? { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 4 } : {}) };
  const start = source.indexOf("  window.addEventListener('message',event=>{const message=event.data||{};if(event.source!==window.parent||message.type!=='PURCHASE_SAVE_RESULT'");
  const end = source.indexOf('  function saveEdits()', start);
  assert.ok(start > 0 && end > start);
  const context = { window: { parent, addEventListener: (_name, fn) => { handler = fn; } }, savePending: request,
    saveInFlight: true, saveCheckPending: false, saveIssue: '', saveAttemptCount: 1, saveOrigin: {}, saveDialog: null,
    setTimeout: (fn, ms) => timers.push({ fn, ms }), cacheDraft: () => cached++, paintSaveTracker() {},
    saveDiagnostic: (_request, message) => message, showStatus() {}, saveButtonState() {},
    saveMessage: () => continued++, finishSave: result => { finished++; assert.equal(result.requestId, request.requestId); },
    document: { querySelector: () => null }, allocationUi: () => ({ rejected() {} }), freezeDialog() {},
    checkSaveReceipt: () => { throw Error('Legacy receipt checker must not process a current reply'); } };
  vm.runInNewContext(source.slice(start, end), context);
  return { request, context, timers, finished: () => finished, continued: () => continued, cached: () => cached,
    reply: (result, extra = {}) => handler({ source: parent, data: { type: 'PURCHASE_SAVE_RESULT', company: 'NCT', requestId: request.requestId, ok: true, result, ...extra } }) };
}
test('valid bounded Purchase progress retains original request/cache and schedules only same save', () => {
  const f = fixture(), before = JSON.stringify(f.request);
  for (const phase of ['BEFORE', 'APPLY', 'VERIFY']) {
    f.reply({ ok: false, pending: true, requestId: f.request.requestId, phase, completedCount: 2, totalRecords: 10 });
    assert.equal(f.finished(), 0); assert.equal(JSON.stringify(f.context.savePending), before);
    assert.ok(f.cached() > 0); f.timers.pop().fn();
  }
  assert.equal(f.continued(), 3);
  f.reply({ ok: true, requestId: f.request.requestId, stockGeneration: 5 }); assert.equal(f.finished(), 1);
});
test('malformed/stale/unknown replies and error text never clear current Purchase pending request', () => {
  const f = fixture();
  for (const result of [{ ok: true, requestId: f.request.requestId }, { ok: true, requestId: f.request.requestId, stockGeneration: 4 },
    { ok: false, pending: true, requestId: f.request.requestId, phase: 'APPLY', completedCount: 11, totalRecords: 10 },
    { ok: false, attemptNotStarted: true, error: 'changed' }]) {
    f.reply(result); assert.equal(f.finished(), 0); assert.equal(f.context.savePending, f.request);
  }
  f.reply(null, { ok: false, error: 'Supplier quantity changed' });
  assert.equal(f.context.savePending, f.request); assert.equal(f.finished(), 0); assert.equal(f.timers.length, 0);
});
test('an obsolete scheduled continuation cannot resend after another action owns the pending slot', () => {
  const f = fixture(); f.reply({ ok: false, pending: true, requestId: f.request.requestId, phase: 'APPLY', completedCount: 1, totalRecords: 3 });
  f.context.savePending = { requestId: 'OTHER' }; f.timers.pop().fn(); assert.equal(f.continued(), 0);
});
test('original legacy successful Purchase receipt still reaches unchanged completion handler', () => {
  const f = fixture(false); f.reply({ ok: true, requestId: f.request.requestId }); assert.equal(f.finished(), 1);
});
test('original mutate now snapshots current form metadata into existing immutable cached request', () => {
  const start = source.indexOf('  function mutate(kind,args)'), end = source.indexOf("  window.addEventListener('message'", start);
  const metadata = source.slice(source.indexOf('  function currentOrderMetadata('), source.indexOf('  function currentOrderSuccess('));
  const context = { currentWorkspaceUpdating:false,savePending: null, data: { stockCurrent: { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 7 } },
    saveIssue: '', saveOrigin: null, saveDialog: null, modal: { open: false }, view: 'active', customerId: 'C', activeCustomer: 'C', company: 'NCT',
    crypto: { randomUUID: () => 'ORIGINAL-UUID' }, saveAttemptCount: 99, saveMessage() {}, showStatus() {}, saveDiagnostic() {} };
  vm.runInNewContext(metadata + source.slice(start, end) + '\nmutate("PURCHASE_SAVE_REQUEST",{operation:"PLAN",input:{totalCtn:50}});', context);
  assert.equal(context.savePending.stockGeneration, 7); context.data.stockCurrent.stockGeneration = 99;
  assert.equal(context.savePending.stockGeneration, 7); assert.equal(context.savePending.requestId, 'ORIGINAL-UUID');
  context.savePending=null;context.currentWorkspaceUpdating=true;
  vm.runInNewContext(metadata + source.slice(start,end)+'\nmutate("PURCHASE_SAVE_REQUEST",{operation:"PLAN",input:{totalCtn:50}});',context);
  assert.equal(context.savePending,null,'no new original write while current workspace refresh is unresolved');
});
