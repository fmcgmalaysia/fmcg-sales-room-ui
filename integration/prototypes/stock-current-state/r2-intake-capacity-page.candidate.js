import { verifyR2Intake } from 'backend/r2IntakeCapacityAcceptance.web.js';
// Temporary NEW unpublished acceptance page only. The backend remains Admin-only,
// physically scoped to the one retained StockProtocolTest fixture. Never seed,
// reset, delete, activate, switch request identity or retry an uncertain call.
const R2_INTAKE_PAGE_ENABLED = false;
$w.onReady(async function () {
  if (!R2_INTAKE_PAGE_ENABLED) return;
  const receipts = [];
  const call = async step => {
    const result = await verifyR2Intake({ step });
    console.info('R2INTAKE_PAGE_RECEIPT ' + JSON.stringify(result));
    if (result?.ok !== true || result.schema !== 'R2_REAL_INTAKE_CAPACITY_V1' || result.step !== step) throw Error('Unconfirmed intake diagnostic result');
    receipts.push(result); return result;
  };
  try {
    // Resume ONLY the same operation whose native three-insert interruption and
    // blocked mixed read were already recorded before the quota stop.
    let state = await call('INSPECT'), injected = true;
    if (state.generation !== 0 || state.pending?.key !== '5a7eb83b6d6e7a1cb390c9f258b8b219'
      || state.pending.digest !== '8c8260ce8b951aa7e8704361bb4911b5' || state.pending.planHash !== '4b841011c2e29deab7ec45a1771253ad'
      || state.pending.count !== 1202 || state.pending.phase !== 'APPLY' || state.pending.cursor !== 140) throw Error('Exact saved intake checkpoint required; no automatic adoption');
    for (let round = 0; round < 190; round++) {
      const pending = state.pending || state.control?.pending;
      const step = !injected && pending?.phase === 'BEFORE' && pending.count - pending.cursor < 20 ? 'FAULT' : 'ADVANCE';
      state = await call(step);
      if (step === 'FAULT') {
        if (state.stage !== 'KNOWN_INTERRUPTION_CONFIRMED' || state.partialBusinessInserts !== 3) throw Error('Known interruption not confirmed');
        injected = true;
        if ((await call('INSPECT')).mixedReadBlocked !== true) throw Error('Partial-read barrier not confirmed');
      }
      if (state.control?.generation === 1) break;
      if (round === 189) throw Error('Intake diagnostic call bound reached');
    }
    const complete = await call('INSPECT'), replay = await call('REPLAY');
    if (!injected || complete.taskCount !== 300 || complete.orderCount !== 300 || complete.productCount !== 300
      || complete.verifiedDomainImages !== 1202 || replay.mutationAttempted !== false) throw Error('Complete intake acceptance evidence required');
    console.info('R2INTAKE_PAGE_COMPLETE ' + JSON.stringify({ receipts, realBusinessAcceptance: false, activationReady: false }));
  } catch (error) {
    console.error('R2INTAKE_PAGE_STOP ' + JSON.stringify({ error: error.message, confirmedReceipts: receipts,
      noAutomaticRetryResetOrCleanup: true }));
  }
});
