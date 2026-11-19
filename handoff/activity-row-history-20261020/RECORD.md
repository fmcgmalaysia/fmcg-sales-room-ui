# Activity row-history reduction — 2026-10-20

## Final publication status

Publication complete for the isolated MOVE ROW retention patch. Runtime d109090db6ffc82494e2ec35044deaadfb2c59b4; functional commit d690720; build marker 2026-10-20-activity-row-history-v1. Pages39411470119 succeeded, six relevant public resources exact. Temporary63696353 already deleted and original seven exact. No deployment or permission re-created during editor recovery.

User reported Master editor recovered. Backend & Public file tree opened purchaseOperations.js; cleared-clipboard full readback remained exactly the candidate, 27,284 CRLF characters, LF SHA256 1428fb2b20886362a57f9a0a106c9feec328a07c56614675bd4f6c7b9675c5f8. No further code edits. One resumed Publish returned native Congratulations / This site is published and live online. Private receipt screenshot root handoff/activity-row-history-20261020/wix-published-live.png. The first shortcut used while locating the file entered Wix Preview; returned via Edit Site without editing or running a business action.

Former in-app tab8 had been cleaned up between turns. A new hidden in-app tab9 opened the real public /master URL; after initial loading, LAW and Purchase Dashboard appeared. This clean page was reloaded once after the publishing receipt, Active Orders opened read-only, and table contained12 rows including header (11 data rows), original task quantities and Move rows entry. Captured error log empty. Private screenshot root handoff/activity-row-history-20261020/purchase-public.png. The page is retained as the release result, not a form to refresh later without checking.

No real reorder, Save, payment, receipt, message or business-data cleanup was performed. User explicitly defers behavioral/full-system acceptance until Stock Card. Four publication stages have evidence; this does not claim a real-CMS row-count saving measurement or user-verified golden-path promotion. Existing six new regression scenarios and prior full-suite results are reused, not rerun for documentation. Source site unchanged; no Source publish, main merge or heartbeat restart.

The historical pending paragraphs below describe intermediate states and are superseded by this final status and RELEASE_STATUS.json. Remaining Activity candidates and broader Stock Card/Sales backlog remain open; completion of PR210 does not close them.

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

## Authorized release preparation

User explicitly approved publication, deferred real business testing until Stock Card is complete, then explicitly approved the temporary Pages permission for fix/activity-row-history-20261020. Repeat native-editor readback immediately before synchronization still matches pre-patch SHA256 47f3ed0142e740cf0add88a3ec28fd6750c07385c467d8b8bc4a3d6db1609a76 with exactly two target appends. Backend-only release uses handoff/activity-row-history-20261020/build.json as its Pages marker; existing frontend and four Wix entry pointers are unchanged. No new behavioral code or test rerun in release preparation. Publication and public smoke verification remain pending until receipts are captured. Source-site Wix publication is not needed for an unchanged Source site.

## Earlier work-method notes

### Release progress and editor recovery

Backend-only runtime d109090db6ffc82494e2ec35044deaadfb2c59b4 deployed successfully by Actions39411470119. Six public resources independently matched the reviewed checkout (build.json, purchaseOperations.js, unchanged Sales/Buyer/Purchase/Warehouse HTML); new build marker verified. User-authorized temporary policy63696353 removed immediately after success; original seven IDs/names/types restored exactly. No new deployment or permission is needed on resumption.

Master native editor Find/Replace matched exactly two full event appends. Replace All removed only those appends. Independent cleared-clipboard full readback is exactly before.split(target).join(''), and matches local candidate LF SHA256 1428fb2b20886362a57f9a0a106c9feec328a07c56614675bd4f6c7b9675c5f8 (27,284 CRLF characters). No other Wix module or entry changed. Publish clicked once; button remained disabled, Autosave off, no success receipt. Editor logs contain failed-fetch/code-worker network errors, not evidence of a business-code build error.

One recovery reload was made with exact old/new code preserved in Git and readback hashes. Editor progressed through89 to98 percent but remained Loading at this checkpoint. No repeated Publish/refresh, alternate auth, whole-file overwrite or business Save. User asked once via asynchronous input to manually recover the existing Master editor; tab51426657 marked for handoff. Root private screenshot handoff/activity-row-history-20261020/wix-loading.png. Existing in-app clean QA tab8 remains Warehouse with LAW/11deliveryrows and no open form; it was inspected but not refreshed or used as proof of the new backend.

Resume: check the preserved editor. If ready, read purchaseOperations.js fully again. Exact candidate may be published after verifying; exact original may receive the same two guarded removals then full comparison; any third state is a conflict and stops writes. Do not assume the interrupted publish failed or succeeded. Obtain native published-live receipt, then use clean in-app QA only for read-only page verification, never reorder/Save or fabricate test data. User deferred real workflow testing until Stock Card. Source site is unchanged and does not need publication. All four statuses must be reported separately; publication is currently incomplete. No monitor was created or resumed.

Reused prior Activity dependency findings and project-framework reads; repeated exact module reads only for fresh live comparison, bounded patch context or truncated output. One broad combined tool result was truncated. A Windows rg wildcard-path mistake and two guessed missing documentation paths were corrected with exact scoped paths; no unchanged blind retry. Browser module selection was initially blocked by an existing CMS overlay; closed the overlay without editing data, then verified the selected file before copying. No hidden editor/runtime state or credentials used.
