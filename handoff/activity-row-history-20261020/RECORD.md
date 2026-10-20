# Activity row-history reduction — 2026-10-20

## Scope and authority

User authorized beginning the discussed evidence-led reduction of meaningless Activity growth. This first isolated patch stops new per-task PURCHASE_ROW_MOVED events from EDIT-with-order and REORDER. Sorting, task version checks, company/customer/invoice restrictions, price audits and operation recovery remain unchanged. No old CMS rows, migration, archive, new storage, permissions or automatic monitors are included. Other candidates remain investigation findings, not implemented improvements.

Branch fix/activity-row-history-20261020 starts at 2298312065e1f72ed67abd19967ae33552f54511 (docs/work-efficiency-20261020). Use that branch as the draft PR base to keep the diff scoped; do not merge its business ancestry into main. Original user-verified recovery tag verified/sales-requested-split-20261020 points to e93006cede80484ef0d4ffb787d0a47c12b428ba. This patch is not a newly user-verified baseline. Immediate before-patch module is recoverable from 2298312; no whole-file synchronization is authorized.

## Fresh comparison

Existing Master Studio tab 51426657, purchaseOperations.js, independently copied in full through the native editor after clearing the clipboard: 27,466 characters. LF-normalized SHA256 47f3ed0142e740cf0add88a3ec28fd6750c07385c467d8b8bc4a3d6db1609a76, identical to the local pre-patch module. Editor copy is a fresh saved-draft comparison; published-live status and public runtime were not re-established this turn. Prior PR208 record contains the last publishing receipts. No Wix source writes occurred.

Opening existing editor also displayed collection overview NCT Activity 88, GHR Activity 0; these are UI-displayed counts, not a fresh live census or growth-rate measurement. Do not extrapolate daily growth or savings from them.

## Dependency findings

- Backend scoped search: MOVE events are created at the two edited sites; purchaseProjection exposes them in task history. Row positions are persisted on tasks and are not reconstructed from MOVE events. Existing history reader compatibility is retained.
- Shared createOperationJournal retains PREPARED and RESULT for recovery. Existing prepared operations may contain old MOVE events; application is deliberately unchanged so those exact old plans finish once. New preparation emits no MOVE event.
- Current allocation Catch Cost uses PURCHASE_REFERENCE_REQUEST and does not directly append Activity; no change needed for this path. The older cost-retry mutation has different recovery/fill semantics and is not removed.
- Allocation next() filters unchanged sources; the main save path requires drafts or a sequence. No-change UI saves already have guards. This does not prove every backend endpoint is no-op optimized. No backend-wide no-op rewrite was made.
- Same request/digest returns the existing operation outcome. Different request IDs are not treated as identical business intents. Receipt deletion or expiry needs a separately designed replay policy.
- GP_RECALCULATED is conditional on changed derived values, not every refresh. Its retention/readers need separate verification before removal.
- Current purchase workspace still reads all Activity pages; this scalability issue is identified but not modified by a two-line event patch.
- Business plan/share revisions remain authoritative chains. Do not archive/delete them merely by record age.

## Patch and acceptance

Two production lines remove only MOVE event appends; task updates and all existing application/journal code are preserved. A new ordering save covering N task IDs retains two journal rows instead of N MOVE rows plus two journal rows. Successful combined edit/order additionally retains its real price audit. Transient locks still insert/remove; this is retained-row reduction, not zero database writes. Replaying the same successful request adds zero rows. Legacy prepared MOVE events can still finish by design. No current daily savings percentage is established.

Before patch: purchase-operations.test.cjs 43/43 pass. After the first five new tests: 48/48 pass. Sixth new test verifies GHR isolation. Focused ordering run 7/7 pass before a readability-only test-fixture adjustment; final tracked integration suite includes the adjusted fixture.

Final tracked integration suite: 707 tests, 703 pass, 4 fail. Same four pre-existing failures documented in the PR208 baseline: customer-short-names mock missing PURCHASE_DOCUMENT_TYPES, INSTALLMENT_PAID versus old PAID assertion, obsolete staff suffix, obsolete bilingual Awaiting balance expectation. No unrelated assertions changed. Untracked historical workbench tests were intentionally excluded by git ls-files. No extra full-suite rerun just to obtain more output is needed.

Six added tests cover retained-row count/idempotent replay and non-position preservation; combined price edit audit; lost first-row response/resume and lock cleanup; stale/incomplete/foreign rejection; legacy prepared-event recovery; GHR/NCT isolation. Existing real-module tests cover Sales split/increase/reduce, original PO, supplier costing/FOC, stock allocation projections and Finance locks.

## Release state

- Code: local two-line patch plus six regression tests; commit/remote identity recorded below when available.
- GitHub Pages: not dispatched; no frontend or build marker change.
- Wix Studio: inspected only, not synchronized or published.
- Public page: not exercised for this patch; no real reorder/price/business test writes.

Functional commit d6907203a6f358df7354eaec531d5132421ed83d pushed and remote tracking SHA verified. Draft PR210 https://github.com/fmcgmalaysia/fmcg-sales-room-ui/pull/210 was created and attached; GitHub reports exactly three changed files, 100 additions and two deletions, base 2298312. Tracked working tree clean after the functional commit. Initial sandbox push failed with getaddrinfo thread error; one authorized network escalation succeeded. This closeout-only addition follows the functional commit and does not change runtime or require rerunning tests.

This is a candidate, not a completed publication. User approval to begin optimization does not itself supply a new Pages deployment-policy exception. No temporary permissions added; main untouched; PR207 heartbeat remains paused.

## Work-method notes

Reused prior Activity dependency findings and project-framework reads; repeated exact module reads only for fresh live comparison, bounded patch context or truncated output. One broad combined tool result was truncated. A Windows rg wildcard-path mistake and two guessed missing documentation paths were corrected with exact scoped paths; no unchanged blind retry. Browser module selection was initially blocked by an existing CMS overlay; closed the overlay without editing data, then verified the selected file before copying. No hidden editor/runtime state or credentials used.
