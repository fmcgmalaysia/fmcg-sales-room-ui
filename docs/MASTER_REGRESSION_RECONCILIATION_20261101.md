# Regression reconciliation — 2026-11-01

Scope: reconcile the original26 failures with the later13 UI failures, using the published Purchase cohort. This is test/documentation maintenance, not a production business patch. Recovery/base9aabd51; current Purchase runtimec844f39, independent receivingfc76b37 and allocation/journal recovery97f9623 remain unchanged. No deployment or permission change is required for this maintenance.

## A single denominator

| Evidence | Tests | Pass | Fail | Meaning |
| --- | ---: | ---: | ---: | --- |
| Original stress baseline |355|329|26|Historical complete stress selection.|
| Original receipt candidate |364|338|26|Nine additional tests; the same26 failures, not26 fixes.|
| Subsequent UI selection |130|117|13|Different scope; none of these13 failure names overlaps the original26.|
| Comparable selection before this maintenance |205|166|39|The75 tests containing the original26 plus the130-test UI selection.|
| Same comparable selection after this maintenance |205|192|13|Zero skips.26 assertions restored to the current contract; not26 production bug fixes.|
| Additional current protected workflow checks |145|145|0|Separate selection; do not add to205 as a unique-case claim without a deduplication audit.|

Of the original26 failures,13 now pass and13 remain. All13 subsequent UI failures now pass. The remaining13 are12 historical prototype checks plus1 current business boundary. Original failure logs and every unresolved test remain; no skip, deletion, production fallback, new stock ledger or forced success was added.

## What changed in tests

- Load the actual customer-allocation UI module and the existing pure allocation planner in the browser harness. Verify the current customer task ALLOC plan, own60 plus free20, one save on a repeated click, and no retired supplier allocation table.
- Replace retired supplier-target payloads in cross-department scenarios with planMode CUSTOMER, or the existing RECONCILE action when reducing a quarantined source. Retain the original quantity, cost, CN/refund, Finance Checked, supplier and company assertions.
- Supply the canonical document-state projection and explicit backend edit permission in fixtures. Paid/locked and unknown permission still deny editing; reviewed/owned/processing requests stay locked.
- Update ETD, Request Paid, staff label and current Stock Actions expectations. Quiet resolved rows are not actionable; the actual Receiving Shortfall decision sends no Finance clearance or customer cancellation.
- Expect Stop Waiting as one message. Receipt45/50 still has remaining5 and unresolved financial risk; repeated submission creates one event/notification.
- Put the credit-term scenario's PO document before final Finance reconciliation. It must not upload a missing PO after final reconciliation merely to arrange a later payment.
- Pure preflight of a deliberately unavailable test load prevents that rejected test selection from leaving a synthetic packing hold. This is harness hygiene; it is not a fix or claim about the public UI.

## Remaining business boundary — MST-13

H08: demand500, PO480, receipt480, first batch300 Loaded/invoiced/dispatched, then quarantine5+3+2. Physical remaining is180, isolated10, usable170. The existing source ledger is not shown to be corrupt. Attempting another180 is refused. Reducing the split allocation480 to470 is also refused with `Loaded batch source correction requires supervised review.`

There is no demonstrated supported supervisory completion path for this case. Keep the failing positive scenario visible: do not turn it into a passing rejection-only test, remove its later financial assertions, relax the Loaded protection, or create another allocation authority. This is backend scenario evidence, not a new live reproduction.

A separately scoped correction must preserve the first300 and its exact source/invoice references, original PO/receipt480, and existing payment locks. It must distinguish unshipped usable170, isolated10 and the other20 not received; leave customer residual30 and supplier/Finance responsibilities open until their proper owners decide them. Replaying or racing the correction must not release or deduct stock twice. No implementation of that policy was made in this maintenance.

## Remaining historical prototype checks — MST-12

Four generated snapshots (H15,H18,H20,H26) differ from later source changes. Two old allocation protocol tests (H21,H22) retain retired v1/v2 payload or version assumptions. Six preparation/Loaded checks (H16,H17,H19,H23,H24,H25) rely on old source evidence, physical stock staying unchanged on Loaded, or unloading after Loaded. They read `integration/prototypes/stock-current-state`; their assumptions cannot redefine the current production ledger.

The Company Stock List authority remains separate NCTOrders/NCTTasks/NCTActivity and NCTOrders1/NCTTasks1/NCTActivity1. Current allocation/save, borrowing/repayment, Loaded once-only, shortload resolution, stock valuation, payment locking and saved-result recovery checks passed. That replacement coverage does not repair or certify the old prototype. Do not regenerate or activate it, archive its checks, or claim these12 resolved under this task.

## Reproduction and evidence

The machine-readable39-row inventory is [master-failure-inventory-20261101.json](../integration/regressions/master-failure-inventory-20261101.json). It retains H01–H26 and U01–U13, original names, status, categories and evidence hashes. The continuing backlog is solely [MASTER_WORK_REGISTER.md](MASTER_WORK_REGISTER.md), MST-12 and MST-13.

Private local evidence: `C:/FMCG-WIX-LOCAL/handoff/master-regression-reconciliation-20261101/`: comparable-final.txt205/192/13; protected-final.txt145/145/0; ui-receiving-final.txt135/135/0; workflow-final.txt16/15/1. Failed diagnostic configurations are retained too: the first expanded protected run incorrectly applied the UI asset shim to historical stage builders; it produced artificial patch-composition failures. The corrected stage-built selection, without that shim, passed145/145. Do not call that diagnostic run a production regression or erase it.

Reproduce with `node integration/tests/run-regression-reconciliation.cjs --assets <exact-c844f39-release-folder> --output <new-evidence-folder>`. It verifies99 resource hashes, preserves every unresolved check and returns nonzero while failures remain. Backend receiving is pinned to the independently publishedfc76b37 hash. Never compare raw checkout assets or a stale receiving file as if they were the composed production cohort.

Release status: Code = tests/docs only; GitHub = separate maintenance branch, never main; Pages = not applicable, runtime unchanged; Wix = not applicable, no edits; Public = no new public acceptance claimed, no browser or business mutation performed. Previous production release and user acceptance status are unchanged.
