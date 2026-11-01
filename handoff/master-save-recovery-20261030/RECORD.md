# Purchase completed-save recovery and bounded PO work

User authorization 2026-10-30: autonomously repair observed MASTER bugs and unreasonable save/refresh waits while the user sleeps; continue background testing when Chrome cannot be used. Work remains within the existing architecture and one stock authority. No real payment or supplier messaging is authorized by this work.

Phase 1 objective: prevent serial PO work from unnecessarily extending requests, and safely recover the original completed eight-line PO after its response/cleanup was lost. Only purchaseOperationJournal.js, purchaseOperations.js and purchaseOperations.web.js are changed, with targeted tests. A later UI/transport improvement will be a separate patch/branch.

Startup completed: root AGENTS.md, START_HERE.md (490 lines, bounded chunks after an initially truncated combined read), checkout supplement, system ownership/record, current quiet-refresh publication record and two-order audit record. The many historical candidates in START_HERE are not current production evidence. One broad prototype search used an invalid Windows glob and was abandoned; work returned to the known production modules. A directory test invocation was corrected to explicit test files after Node treated it as a module.

Recovery source: published 0b61b6e (record fdb5afb), 94-resource purchase-quiet-refresh-v1 package retained. Protected annotated tags for row-drag-save, requested split and stop-waiting remain unchanged. Fresh Wix full-source copies of all three modified modules match repository originals after newline normalization and are privately preserved under root handoff/master-save-recovery-20261030/live-before. No verified tag is fabricated for the unaccepted current workflow.

Design:
- Original journal remains the authority; operation/request/member identities, prepare plan, immutable business events and result record are preserved. Inventory, allocation, financial locks and Loaded deduction are unchanged.
- Only independent PO row work uses a maximum of four workers. Every started worker joins before cleanup; other operations keep their existing order. A failure cannot release locks while another launched update is still running.
- Completed-only recovery is opt-in for PO. It requires the exact original request digest and lock owner, an old enough original plan, every intended task patch and its original version reconstruction, every expected saved audit, no invoice lock and no foreign task lock. Age alone never permits a recovery.
- A unique recovery executor claim prevents simultaneous original retries from cleaning each other's locks. Interrupted recovery retains the original plan/result; another executor must wait for the prior recovery to quiesce. Failed/incomplete or changed business data remains blocked for review. This is not an automatic lease for unfinished operations.
- Recovery writes the original result without repeating business updates, removes only its own task locks, then releases its own company lock. The result-check interface stays pending until that cleanup completes. Lost claim/result/delete acknowledgements are covered.

Evidence so far:
- Published originals reproduce five of seven new performance/recovery assertions failing; candidate initial seven pass.
- Current targeted recovery/web checks: 23 pass including lost acknowledgements and interrupted cleanup. Existing purchase operations: 49 pass. Direct current allocation-draft tests: 9 pass.
- All 342 integration test files: 2600 tests, 2475 pass, 125 fail. Failed files were checked with original published backend sources; 122 reproduced, and three nested prototype regression failures reproduced separately. Current and baseline failure-name sets match (124 unique names; one repeated assertion). No new full-suite failure identified. Most failures are retired release manifests or inactive R2/prototype assumptions; they were not rewritten to manufacture a pass. Detailed logs are private. This is not an all-green suite claim.
- No production save retried under candidate code yet. No Wix source modified or published at this point. No Pages permission changed. Main untouched.

Remaining: GitHub candidate sync, minimal Wix draft patches/readbacks, publication and original-request live recovery, then original Warehouse receipt and the rest of the two-order scenario. UI saving feedback, unnecessary refresh work and mixed transport presentation remain separate approved phases.

## 2026-10-30 continuation

- Code e85998380937a3520d71d37f0797ebd137155e2c synchronized to its isolated branch; draft PR239 attached. Main unchanged.
- Wix: four journal, five operation and two web-interface unique fragments applied, then each full module read back exactly against the tested candidate. The Purchase page remained byte-equivalent after newline normalization. Wix confirmed "This site is published and live online"; private source hashes and screenshot retained.
- Editor transitions/replacement commands occasionally returned stale state. Work stopped at each mismatch, read back the actual source and completed only missing unique fragments. No page code was changed.
- Pages: no frontend deployment or permission change. Existing Purchase build 20261029-purchase-quiet-refresh-v1 returned HTTP200. Public app bytes match the preserved package and the repository's assembled quiet-refresh plan exactly; the raw app source differs because existing receipt-feedback changes are applied by the staged release chain. Do not deploy the raw app file as a replacement.
- Public acceptance incomplete: original request 59805f5f-8a35-405d-883c-ab5d8b68e37f retried on the existing tab but remained pending. The tab was refreshed to load the new Wix revision; its embed remained blank and later browser evaluation timed out. A new tab opened by normal Chrome navigation loaded both customers successfully, but does not contain the original tab's session draft. No new PO identity or manual lock deletion used. Original Warehouse receipt remains pending and Loaded has not been reached.
- Monitoring's last-seven-days counters are historical totals, not the two-order test. They show repeated company-wide reads and save latency requiring further inspection; do not extrapolate new CMS record growth from request counts.
- User subsequently supplied a screenshot of the old Purchase customer layout and explicitly requested its removal. Next isolated objective is to route all task entries and restored drafts through the existing Active Orders layout while retaining the original pending request and every business handler.
