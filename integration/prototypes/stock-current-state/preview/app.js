'use strict';
const $ = id => document.getElementById(id), model = window.BorrowingModel;
let state, action, nextRelation = 1;
function reset() {
  const identity = { company: 'NCT', barcode: 'DEMO-001', packing: '24 × 1', ea: 24 };
  state = { ...identity, complete: true, revision: 0,
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'DEMO', heldByTask: { A: 0, B: 0 } },
    tasks: ['A', 'B'].map(id => ({ ...identity, id, customerId: 'DEMO-' + id, requested: 100, dispatched: 0 })),
    sources: ['A', 'B'].map(id => ({ ...identity, id: 'S-' + id, ownerTaskId: id, poId: 'DEMO-PO-' + id, poValid: true,
      reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', ownerShare: 100, planned: 100, accepted: id === 'B' ? 100 : 0,
      onHand: id === 'B' ? 100 : 0, isolated: 0, available: 0, claims: { [id]: id === 'B' ? 100 : 0 } })), relations: [] };
  nextRelation = 1; $('status').textContent = ''; render();
}
function render() {
  $('revision').textContent = 'Preview revision 候选版本 ' + state.revision;
  $('tasks').innerHTML = state.tasks.map((task, index) => {
    const v = model.taskCoverage(state, task.id), own = state.sources.find(s => s.ownerTaskId === task.id), icon = window.TransferPerson.transferPerson({ taskId: task.id, relations: state.relations });
    return '<tr><td>00' + (index + 1) + '</td><td><b>Customer ' + task.id + '</b><small>DEMO 示例客户</small></td><td>Chocolate Biscuits 巧克力饼干<small>DEMO-001 · 24 × 1</small></td><td>' + v.requested + '</td><td>' + own.accepted + '</td><td>' + v.reservedUsable + '</td><td>' + v.dispatched + '</td><td><button class="person ' + (v.uncovered || v.pendingReplacement ? 'pending' : 'complete') + (icon.halo ? ' halo' : '') + '" data-task="' + task.id + '">' + icon.svg + '<span>Supplier DEMO</span></button></td></tr>';
  }).join('');
  $('relations').replaceChildren();
  for (const r of state.relations) {
    const node = document.createElement('div'), remaining = model.relationRemaining(r); node.className = 'relation';
    node.textContent = 'A ← B · Borrowed 借入 ' + r.quantity + ' · Repaid 已补 ' + r.repaid + ' · Returned 已退 ' + (r.returned || 0) + ' · Outstanding 待补 ' + remaining;
    if (!remaining) { node.classList.add('closed'); node.textContent += ' · Completed 已结束'; }
    $('relations').append(node);
  }
  if (!state.relations.length) $('relations').textContent = 'No borrowing relationship 暂无借货关系';
  $('totals').textContent = 'Warehouse On Hand 货仓在手 ' + state.sources.reduce((n, s) => n + s.onHand, 0) + ' CTN · Available 自由库存 ' + state.sources.reduce((n, s) => n + s.available, 0) + ' CTN';
  document.querySelectorAll('[data-task]').forEach(button => button.onclick = () => {
    const records = model.procurementOutstanding(state, button.dataset.task);
    $('status').textContent = records.length ? records.map(r => 'Outstanding relationship 未结关系 ' + r.relationId + ' · ' + r.remaining + ' CTN').join('；') : 'No outstanding transfer 没有未结调货关系';
  });
}
const labels = {
  approve: ['Borrow for A 给A借货', 'Purchase approves B’s usable stock for A and reserves A’s P.O. receipts for replacement. 采购批准B的现货给A，并绑定A的PO到货补回。', 30],
  receive: ['Receive A P.O. A的PO收货', 'Enter cumulative accepted cartons. Bound replacements run first. 输入累计合格实收数量，系统先补回绑定的货。', 20],
  dispatch: ['Dispatch A 实际发货给A', 'This confirms actual departure in the demo. Only A’s available claims can be shipped. 示例中确认实际离仓，只能使用A的已分配货。', 30],
  return: ['Return Unused 退回未用借货', 'Purchase may return unused and unheld borrowing. 已发货或已占用的借货不能直接退回。', 30],
  correct: ['Correct Receipt 更正实收', 'Enter corrected cumulative accepted cartons. Existing production finance checks remain required. 输入更正后的累计实收；正式接入仍需原财务保护。', 20]
};
Object.keys(labels).forEach(id => $(id).onclick = () => {
  action = id; $('dialogTitle').textContent = labels[id][0]; $('dialogHelp').textContent = labels[id][1];
  $('quantity').value = labels[id][2]; $('reason').value = ''; $('error').textContent = ''; $('dialog').showModal();
});
$('form').onsubmit = e => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const quantity = Number($('quantity').value), reason = $('reason').value.trim(), common = { expectedRevision: state.revision, reason, approvedBy: 'DEMO-PURCHASE' };
  try {
    if (action === 'approve') state = model.approveBorrow(state, { ...common, id: 'DEMO-' + nextRelation++, quantity, lenderSourceId: 'S-B', replacementSourceId: 'S-A', borrowerTaskId: 'A' }).after;
    if (action === 'receive' || action === 'correct') state = model[action === 'receive' ? 'receive' : 'correctAccepted'](state, { ...common, sourceId: 'S-A', cumulativeAccepted: quantity }).after;
    if (action === 'return') {
      const r = state.relations.find(r => model.relationRemaining(r) > 0); if (!r) throw Error('No outstanding borrowing 没有未结借货');
      state = model.returnUnusedBorrow(state, { ...common, relationId: r.id, quantity }).after;
    }
    if (action === 'dispatch') {
      let next = state, left = quantity;
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw Error('Enter whole cartons 输入正整数箱数');
      for (const source of state.sources.slice().sort((a, b) => a.id === 'S-B' ? -1 : b.id === 'S-B' ? 1 : 0)) {
        const take = Math.min(left, source.claims.A || 0); if (!take) continue;
        next = model.dispatch(next, { expectedRevision: next.revision, sourceId: source.id, taskId: 'A', quantity: take }).after; left -= take;
      }
      if (left) throw Error('Shipment exceeds A’s ready stock 发货超过A可用数量'); state = next;
    }
    $('dialog').close(); $('status').textContent = 'Preview updated 候选已更新 · No business data saved 没有保存真实业务数据'; render();
  } catch (error) { $('error').textContent = error.message; }
};
$('close').onclick = $('cancel').onclick = () => $('dialog').close();
$('reset').onclick = reset; reset();
