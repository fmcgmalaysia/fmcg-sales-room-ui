# Customer allocation and borrowing candidate — 2026-10-29

## Authorized scope and recovery

User approved first-version customer allocation: own reservation, free received stock, explicit borrowing from another customer's unheld receipts, no onward lending of borrowed stock, durable outstanding responsibility and explicit repayment. Preserve one source allocation authority and one physical Loaded outflow authority. Include the independently requested TESTING02 300 split200+100 source-inline rendering repair.

Runtime recovery is6971fb1315f8ebc36f9814ce65ecb302f2db5397 /20261029-support-details-v1, preserved92asset package. Local annotated checkpoint/purchase-split-before-20261029 references it. Existing verified sales-requested-split, purchase-row-drag-save and stop-waiting-CN tags remain protected; current runtime is not a newly user-verified full workflow. Main stays unchanged.

Framework reused from the same-session complete startup reads (root AGENTS/START_HERE, checkout supplement, WORK_EFFICIENCY, system ownership and HEADER_RELEASE). Expanded scope explicitly approved in chat. Root START_HERE is historical; no checkout START_HERE exists. Current reread had truncated output; prior complete range reads remain the source for unchanged sections.

## Authority and current implementation

- Fresh Wix plannerAllocation.js full-source anchored regex matched1of1 against original repository source before editing. Exact original and hash evidence are private under root handoff/purchase-allocation-borrow-20261029. No Wix source was edited.
- customerAllocationPlan.js is a pure planner; it owns no balance, store or stock deduction. customerAllocationContext.js normalizes existing receipt/source reservations and reads loan responsibility attached to allocation events.
- plannerAllocation.js candidate supports one grouped source-change event under the original company PURCHASE journal. readAllocations expands that single committed event into the same original source allocation view used by receipt/Support/Loaded consumers. Source changes and loan responsibility share one insert. There is no CURRENT_V2 activation or alternative stock store.
- Previously unmaterialized supplier customer earmarks must be retained and materialized in that same event, otherwise own200 would disappear from the authoritative reader when only free20+borrow30 are saved.
- New receipt does not clear debt. Repayment explicitly allocates physically free stock to lender and decreases that same obligation in one event.

## Completed candidate tests

Focused43/43 pass:9planning scenarios,6real-journal borrowing/repayment scenarios,4original planner tests,3receipt/Loaded composition,6split-inline rendering,8batch entitlement and7physical projection tests. Includes post-commit lost response/same-ID retry, competing concurrent requests, stale stock, insufficient donor/no partial commit, own200+free20+borrow30, lender280→250→280, debt30→0, physical balances unchanged during allocation and repayment.

Earlier29/29source-grid/display-order tests passed for the rendering patch. Reuse outputs; rerun after relevant changes only. These are isolated tests, not production acceptance.

## Remaining before release

1. Complete fresh comparison of other changed existing Wix modules; do not edit them first.
2. Projection and client dialog integration: actual selected shipment batch, source metadata, debt and repayment task entry. Ordinary waiting must use orange; real inconsistency red. Preserve original Save request identity and retry flow.
3. All shared consumers must honor explicit allocation batch distribution, including Support readiness and Loaded source limits; procurement coverage cannot cap borrowed coverage incorrectly.
4. Guard cancellation/reduction/archive and original allocation edits against unresolved borrowing; keep lender shortage and borrowing responsibility as one procurement need, accounting for existing in-transit PO without cancelling it.
5. Test real cross-room composition for borrowed-source Loaded, partial Loaded/cancellation/unheld return, source costs/GP, frozen stop-waiting CN, multi-batch sources, snapshots and recovery. Current tests do not establish these completed.
6. Scope release recipe against immutable current92assets; do not replace current deployed app with a root file lacking save-continuity overlays. Complete staged browser QA, required regression, GitHub commit/push/draft PR, exact Wix patches and four release stages. New branch deployment permission, if needed, must be scoped to final concrete package.

## Release status

Code: in progress, uncommitted. GitHub: not synced for this task. Pages: unchanged. Wix: no source changes or publish. Public acceptance: not started. No production allocation, borrowing, PO or Loaded transaction has been submitted.

## Candidate completion update

The scoped candidate now includes the actual customer/batch dialog, explicit lender confirmation, repayment and unshipped return, a persistent outstanding-borrowing panel, old-client rejection, protected cancellation/reduction/archive, and quarantine allocation reconciliation. The arbitrary source-target writer and its editing dialog were retired; existing allocation history remains readable. Every new action writes source changes and any responsibility update as one original allocation event under the same company journal. No new inventory collection, stock balance or outflow mechanism was introduced.

Quarantine reconciliation only reduces an affected claim, requires a reason, retains receipt/exception history and borrowing responsibility, and cannot reduce Loaded or invoice protection. Received good cartons remain usable while the separately excluded cartons are quarantined. A later receipt does not duplicate satisfied customer coverage or silently clear debt. Repayment may use free stock or explicitly reconcile a newly received lender earmark.

Current regression:375tests,374passed; only the unchanged Sales/Buyer wording assertion from HEADER_VALIDATION remains. VALIDATION.json includes16source hashes, checked unchanged before/after the run. The additional old split-fixture `Loaded identity requires review` failure was separately reproduced on the untouched parent; it is not used as a passing acceptance check. Raw baseline and candidate logs remain private. A new test title was corrected to describe its actual partial-receipt assertion, without changing its assertions.

BROWSER.json uses the actual94resource candidate and real allocation/Sales factories:250demand,200own,20free,30borrowed; no write until confirmation; A250/B250/debt30; exactly one allocation submission. The300split200+100 renders supplier, whole cost and original PO on the200main row, no duplicate source child and no inherited source on the100pending row. The pending row opens its correct allocation dialog. Screenshots are private local candidates.

PROTECTED_BROWSER.json confirms the existing Support compact header, Desk1→2→1, ENTRY-only navigation, operational Warehouse authorization,9Warehouse columns, unknown-result same-request retry, queued writes, Loaded80+50 and original photos retained on a rejected save. Seven actual Warehouse response payloads were screened for financial fields. No external network or production writes occurred in either isolated browser test.

Fresh original comparisons for8existing backend modules plus the Purchase entry page match the deployed/repository baseline. WIX_PATCHES.json has17isolated hunks across9existing sources and2new private backend modules. No Wix source has been changed yet. Static staging changes only6Purchase assets, inherits the other88unchanged assets, preserves all9retired paths and includes no backend/private evidence. The final package must be regenerated after the pinned Git commit.

First-version boundaries: one lender covers the remaining shortage per confirmation; a customer connected to an open borrowing responsibility cannot lend onward. Loaded or invoiced borrowed stock cannot be physically reversed through the unshipped-return button. Multi-batch source correction after Loaded requires supervised review, preserving existing posted outflow rather than guessing which batch lost stock. Partial repayment uses available free receipts; an unmaterialized lender earmark is confirmed as a whole so a partial debt clear cannot accidentally materialize a larger allocation.

Remaining release work: Git commit/push and draft PR, final package pin,11Wix source synchronizations, scoped Pages deployment with temporary permission restoration if required, Wix publish receipt, and actual public read-only verification. User business transaction acceptance remains pending and main must not be merged.
