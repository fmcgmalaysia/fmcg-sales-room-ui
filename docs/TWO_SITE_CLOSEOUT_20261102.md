# Two-site closeout — 2 November 2026

Current candidate extends the versioned, freshly compared 28bcf9a production bundle. Customer invoice matching/history (5b0fe72), Sales Department (dad6795), and Buyer refresh coalescing (22caddc) remain distinguishable checkpoints. Main is untouched. No new receipt, stock adjustment, payment posting or commission payout has occurred.

## Evidence-led patches

1. Buyer had two periodic workspace readers: Wix parent15s and visible iframe60s. One visible-frame15s reader now retains the previous visible freshness, while read-only bursts coalesce. Mutation readback stays fresh and superseded results cannot overwrite it. Hidden frames stop periodic reads. Five behavioral checks pass.
2. Finance additional payment-proof uploads now retain the existing payment reference. The existing paymentId and append-files writer remain unchanged; no second cash transaction is created. Missing payment identity does not open an orphan file-upload form.
3. Warehouse automatically clears only the two resolved, local missing-reason validation messages after valid receipt input. Pending save, server failure, quantity validation, correction reasons and stopped-receiving guards remain intact.
4. Finance shows unknown values while Supplier Accounts loads, rather than presenting false zero totals. Confirmed empty results still show real0. Finance shipment labels use ETD without changing date values.

Four focused audit checks pass. Initial test-harness failures are preserved in the root handoff; they were missing harness function/date context, not bypassed production guards. The patches are small transformations of the exact published files. Older raw Warehouse/payment-layout sources are not substituted for the newer verified bundle. The patch registry and final resource hashes are the reproducible source for these transformations.

## Still required before a complete release

Both Wix Studio editors remain in platform startup. Master console reports a Wix-owned fedopsLogger ReferenceError; this is recorded, not patched by injecting vendor globals. Fresh originals were captured before candidate implementation. No candidate draft synchronization or publish receipt exists. Public Finance and Purchase on28bcf9a are accessible through the existing in-app browser: confirmed/unconfirmed Payable distinctions and the locked payment-request detail were read without saving.

The final package has105 static resources,18 differences from28bcf9a. It includes the prerequisite customer-payment/history and Sales Department work; four existing source-site page version references need synchronized publication with backend dependencies. Actual customer PDF delivery, ordinary customer/staff role access, actual receipt matching and commission policy/data remain separate acceptance or business-definition items. Do not mark them complete from isolated tests. SUNQUICK barcode and cost migration remain explicitly deferred.

## Audit coverage and retained boundaries

All18 HTML resources in the candidate manifest and their referenced scripts were inventoried, including login, Catalogue sidebar, Sales/Buyer, four MASTER rooms, stock views, lightboxes and retained redirect/preview resources. Referenced relative static dependencies resolve; all shipped classic scripts parse. Nine versioned source-site/MASTER page entry files were reviewed for query and timer consumers. This is background code coverage, not a fresh visual/login pass of every Wix page. Catalogue and login were not modified from unexamined live code.

Sales customer refresh already checks hidden state and coalesces requests. Purchase waits for its pending read and protects open edits; Warehouse refresh protects dialogs, pending saves and stopped receiving. Chat timers serve separate visible message projections, not duplicate stock writers. Catalogue's slide timer is a visual animation, not a CMS read. These mechanisms were retained. No automated bulk cleanup, journal deletion, replacement stock store or cost migration was performed.

MST05 stale-version form recovery remains a design/acceptance item: retaining an old draft is safe, silently replaying it against a changed stock or accounting version is not. MST09 live P50/P95, concurrent-user measurements and lifecycle budget remain open; isolated traversal tests do not certify CMS capacity. The historical536-item measurement is dated and is not a fresh CMS count. The older13-test cohort was already reconciled in the month-end work; this task's10 Buyer fixtures plus3 extended fixtures are a different cohort. Do not combine them into a misleading remaining-failure count.

Sales Department's Term field currently has no populated authoritative customer values. Commission payout/rate/reversal rules and an authoritative Finance payout record are not yet defined. Requested blank Transport/Others Cost/Net Comm stay blank; the system does not fabricate paid commission, realized bank FX or missing FOC costs. These are explicitly unfinished business/data contracts, not secretly implemented defaults.

GitHub Pages restricted deployment, exact resource verification, Wix published/live receipts and fresh public-page tests remain mandatory. No temporary deployment rule has been added for this branch.

## Final backend and test follow-up

Customer history builds a snapshot index once and reuses the confirmed Loaded projection, preserving duplicate-evidence rejection and the existing Finance/file authorities. A500-invoice isolated test verifies bounded event traversals; this is not a production latency claim. Final selected42-file suite:381/381, no failures or skips. The10 old Buyer failures and3 additionally encountered fixtures are reconciled separately from production fixes. No R2 activation guard was weakened; its separate unclassified-writer experiment remains offline. The historical complete regression evidence is retained.

Catalogue follow-up (MST19): the versioned Catalogue page calls getBoundingRect every180ms for menu hiding and reads selection state every15s without an evident in-flight guard. This is a potential repeated-work/slow-network risk, not a measured live failure. Its fresh live page code was not captured before Studio stalled. Preserve selection repair and customer authorization; compare the live source before adding menu-open/overlap guards. No Catalogue production patch is included.

Final public/control follow-up: launching Master Studio from the existing dashboard again reached98% and stalled. Saved the screenshot/error log; agent-created stalled editor tabs with no new candidate writes were closed, preserving user tabs and the Support proof form. Purchase unpaid FENCE supplier plan showed disabled ordinary fields plus the expected Amend PO entry; no value or Save was submitted. The Cancel click timed out and the embedded body then appeared blank, so modal-close/public-session recovery is not declared solved. Additional Catalogue/QD protected checks:28/28. Separate from381, not an all-page visual pass.

## Resumed Wix and GP write suppression — 2 November, morning

The user reported Wix recovery. Master Studio now exposes an operable code surface. Fresh full copies of purchaseMarginRefresh.js and purchaseOperationJournal.js match the checkout after newline normalization; exact originals and hashes are retained locally. The existing canonical comparison export is already deployed. No journal function, operation identity, GP formula, FX source, financial lock or inventory path is replaced.

Fresh NCT Activity list shows2,872 records, versus the dated429-activity baseline. Many visible records repeat the same task's unchanged GP/FX and invoice summary; this does not attribute every new row to this bug. An isolated reproduction confirms object-key reordering makes the old JSON hash comparison treat identical invoice summaries as different. Twenty repeated refreshes produce21 GP events including the initial calculation. A minimal patch uses the existing canonical comparator and rechecks the current cache inside the existing GP lock. The same scenarios retain one event, including stale input and overlapping refreshes. Real open FX/cost changes still recalculate; unknown inputs stay unknown and concurrent changes/locks fail closed. Existing duplicate records are not deleted.

The production-source patch has30 relevant tests passing. A newly selected39-file affected run passes387/387 with no skipped tests; its coverage overlaps the earlier381 and is not additive. The earlier in-memory proposal run had4 historical frozen-bundle fixture failures, retained in the diagnostic log; no frozen guard was weakened. Five isolated proposal checks also passed after correcting cross-VM assertion prototypes in the diagnostic harness.

Master's14 candidate drafts (the original13 Master files plus GP) are now minimally synchronized and fully read back. FMCG's5 candidate files and Catalogue fresh-read audit remain pending while its editor loads. Pages and both Wix publications have not happened. Original7 deployment rules remain unchanged. No new receipt, Loaded, real payment, commission, loss or CMS deletion occurred.

## FMCG recovery and Catalogue timer completion

The user opened an operable FMCG editor. All5 existing candidate files were synchronized and fully read back; the existing staff identity export was inspected without changing it. A fresh Catalogue page exactly matches its versioned baseline (trimmed LF SHA2568ad22d86142c6bf71a54f61f9d5d0418af7b42f1be03e4d95af0691ff4c9c351).

The Catalogue page now skips overlapping buyer selection-state ticks without changing cadence, authentication failure handling, selection save or QD routing. Menu geometry checks run only while the menu is open and never overlap; a freshly opened menu establishes a new scroll baseline. This avoids stale closed-menu scroll offsets accidentally closing a newly opened menu. Unknown visibility APIs and alternate selection routes were not introduced. Five new behavioral/protection tests plus existing Catalogue access/QD/sort checks pass31/31, no skips. Full readback matches the source; the original absent final newline is normalized for comparison rather than adding an unnecessary EOF edit.

There are now20 exact Wix drafts:14 Master,6 FMCG including Catalogue. The105-resource static package remains unchanged from the prior candidate, with18 changes against28bcf9a. Pages, both published/live receipts, live GP repeat-read/no-growth verification, actual salesperson/customer access and financial/file acceptance are still required. Deployment permissions remain the original7.
