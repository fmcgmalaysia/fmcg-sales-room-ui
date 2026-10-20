# Purchase independent split mother controls — 2026-10-20

## Authority and boundary

User approved completion and temporary Pages permission for feat/purchase-split-row-controls-20261020 only, remove immediately after release and verify original seven policies. No main merge, new Drive access, test business records or stock-source implementation. Parent action-affordances changes are the explicitly approved UI batch; Sales messaging ba45952/PR213 already has separate four-stage evidence and must not be redeployed as unfinished work.

Branch starts at1982adc; protected recovery verified/sales-requested-split-20261020=e93006c. Independent shipment mothers are display/demand identities, not duplicated supplier tasks, PO lines, receipts or Finance obligations. Original supplier sources appear once. Mother selection moves display rows; supplier source selection creates PO. Existing batch-aware allocation remains unchanged.

## Minimal implementation

New purchaseDisplayOrder backend helper stores row-key ordering inside existing Save PREPARED/RESULT receipts. No new collection, per-move Activity, demand/task/PO/receipt copy or schema migration. Completed same-company/request results alone expose order metadata. Existing rowPosition writes, task versions, invoice and Finance protections, same-ID recovery and audit policy remain. New frontend display helper decorates the established grid, independently numbers and moves split rows, preserves supplier children exactly once, and sends original real task IDs plus validated display metadata through existing EDIT Save. Drafts retain captured version; changes to Sales split or quantities reject stale sorting.

Fresh Wix original comparison before editing and again after browser connection changed5→6: purchaseOperations normalized3d6d646e856337f5c0b738634f51277d3de77feed354f74b25278dd2b7567424; purchaseProjection normalized0ddb30352df13587839f7ee0125d1a4f43e995a9c399e9ddbdfad5fd92fc9e5d; both exact Git originals. No live conflict.

## Verification

Eight new backend/frontend tests: identity equivalence, order receipt projection, forks/incomplete saves, stale Sales changes, supplier once, genuine Save persistence with original PO/Finance-owned state unchanged, two receipts only, exact replay and partial-write recovery, invoice lock. Focused60 and3 checks passed. Actual local browser passed independent numbering, batch checkbox Move dialog, native drag, cancel, synthetic Save/readback, session draft restore and mobile handles; no production writes.

Final integration suite728 total724 pass, same four historical failures as documented baseline: customer-short-names expected staff-authorizer string, master-workflow INSTALLMENT_PAID vs PAID, purchase-live-ui staff suffix, purchase-quantity-projection translated copy. No new failures after fixing drag compatibility and updating only changed UX expectations (blank GP, readonly PO summary, Follow-up-only edit, passive grey status). Test harness formerly matched unknown new drag selectors to old handles; production now explicitly checks display handle identity, preserving legacy path. Parent UI affordances/browser evidence remains in its record.

## Current release state

Runtime3fd4aa084a01e16a66c127cf47fe41a7dc30ccd2 (functional d55f1c0 plus whitespace-only correction) pushed, draft PR214 attached, base Sales messaging branch. Pages run39438451959 SUCCESS. Four build markers2026-10-20-split-controls-v1 and14 public resources exact, including unchanged Sales/Buyer/message assets. Temporary policy63718382 removed immediately after run success; original seven exact. Pages verifier initially treated PowerShell line-array -notmatch output as a boolean; corrected the diagnostic only, then completed exact manifest; no redispatch.

Wix new purchaseDisplayOrder module complete readback exact; purchaseOperations six isolated hunks normalizedSHA a97380aef434120d59de8b4e2a0444ed28d800e8589bc918b540d14095f87039; purchaseProjection two isolated hunks c37debc748144bdeb96f32cdf5d9c2458151f261981f4322fc3668eb520bb4ed. Four entry version-only full readbacks exact: Purchase806ef1fbde191eecf40fb938da5bb00853010c72673c96d4c64f7448db34153c; Account77597d7cdd159afd932ef591e7b9498331eeaeaeba1e22b3b07e81df0dd6aee8; Warehouse5871a754a4ed728fec202dd66cca7cafbc97dcf3dc4bb7b7196e99c13e72ecd5; Support2a657377db5d04661f071c80651b977231ddd2997665fce191c557e9ea8eb770. First Purchase page switch still exposed prior projection editor; baseline guard stopped without writing, next fresh read matched original843b3a exact. Not a real live-versus-repository conflict and no whole-file overwrite.

Publish was invoked once via native Publish button and is awaiting Wix completion receipt. Public stage not yet checked for this runtime; do not claim published until receipt and public QA. No real order/message/PO/payment/warehouse write was performed. Ready Stock remains discussion only. Browser reconnected from Chrome5 to6; same tabs retained, no new browser workaround or login attempt.

### Public verification and native publish inconsistency

Wix returned native “Your site can’t be published / temporary technical issue” after first attempt; screenshot private wix-publish-temporary-error.png. Despite this, clean public IAB10 Account and Purchase show new split-controls-v1 pointers, LAW and actual records; Purchase exposes new display-row metadata (11 mother handles, 010/011 split80/20). Thus runtime is observable but a successful native publication receipt remains mandatory. No production Save performed. Account actual PO computed#2563EB/600. Split Move dialog opened/closed without Apply/Save and selection cleared. Public inspection found its customer-local Before Row numbers could conflict with global table numbering; removed the misleading destination numbers, retaining product/quantity/batch labels. One copy-only app hunk plus app cache token v2; local actual-browser QA and eight display/save tests rerun and passed. No business logic or backend revision for this correction.

## Ready Stock decision — discussion only, not implemented

Current warehousePreparation.readyStockFor already reads physical warehouse receipts and stock.availablePhysical, deducts allocations held for other customer demand, accounts for actual dispatch and caps the customer's remaining commitment. It is not an Incoming+stock calculation or a blank placeholder. The future Stock Card pool must keep this distinct from general free inventory.

- Incoming is ordered/not received; never counts as Ready or Available.
- Physical usable on-hand excludes dispatched, quarantine, damage and unavailable quantities, using authoritative receiving/stock events, not procurement estimates.
- Purchase available-to-allocate = usable on-hand minus outstanding customer allocations/reservations, counting overlapping reservation categories once. Finance approval affects valuation/correction authority; newly quarantined stock must stop allocation immediately.
- Warehouse row Ready Qty = this delivery demand's assigned usable physically received stock, capped by its remaining delivery quantity. Its own reservation must not be subtracted again. Do not show the global free pool as every row's ready quantity.
- Deferred next-shipment stock remains reserved for that customer, not automatically free. Cancellation releases the cancelled unshipped allocation; cartons become free only if actually received and usable. Changing shipment display rows alone never creates stock or duplicates receipts.
- Product pool identity must include company and real product/packing identity; lots/expiry/status remain distinguishable where necessary. Avoid double-deducting dispatched cartons or the same Support invoice reservation.

This record does not add Stock Card CMS, change warehouse formulas, stock authority, allocation, valuation or user data. Separate user-approved Stock Card work must establish authoritative balances/reservations and acceptance examples before implementation.

### Final static runtime and public checks

Copy correction runtime c9bd6d68216c4fd564fd682d448876761e461839, Pages39439531661 SUCCESS. Only two changed static resources app.js/index.html freshly compared exact; other twelve unchanged from prior14-asset exact manifest. Temporary63719322 removed/original seven exact. No third Pages dispatch or main merge.

Second native Wix Publish after the recorded temporary failure returned “Congratulations This site is published and live online”; private master-published-live-first.png. Public Purchase first showed app query v1 despite updated Pages index, revealing cached iframe HTML; a version-only Purchase Wix entry v1→v2 was necessary. Fresh minimal one-line full readback normalized5378a2a62eac919ffd4ed38be24b6d36bbf66bc91ff0216381c903cb2b4a9147 exact. New native Publish of this cache entry is pending receipt; do not confuse its pending state with prior success. Backend and other three entries unchanged.

Public IAB10 read-only QA: Account newpointer/LAW/3 records and computed PO#2563EB/600; Purchase newpointer/LAW/11 independent mother handles and split010/011 80/20, original source not duplicated; split Move opened/closed without Apply/Save. Follow-up grey tag SPAN, one eligible Editable opens original amount input without Save. Submitted PO summary zero inputs, footer display:none, bilingual Follow-up directions. Warehouse newpointer/LAW/11 delivery tasks and exact existing camera SVG; Support newpointer/LAW/no shipment requests. Private screenshots account-public.png,purchase-public.png,purchase-move-public.png,payment-readonly-public.png,warehouse-public.png,support-public.png. The first move screenshot predates cache correction; final v2 entry public verification still required.
