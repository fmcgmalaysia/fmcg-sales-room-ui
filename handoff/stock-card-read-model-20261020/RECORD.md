# Stock Card read model — 2026-10-20

## Current state

Local first-stage candidate only. Branch feat/stock-card-read-model-20261020 starts from 5e3205632f525e35b6c1ea031662fe28cf82d9db, the PR214 release record. No existing production file changed; no Wix synchronization, deployment, CMS schema/data write, permission change or main merge. The user is independently testing PR214. Do not treat this candidate as a production Stock Card.

Approved objective: establish Stock Card sources/save safety, then an initially read-only Warehouse/Finance view before Purchase stock-first reservations. No synthetic production orders are required yet. Existing root AGENTS and efficiency supplement apply. Relevant framework was reused from this ongoing task; fresh reads were limited to current rules, current release override and demonstrated stock/save dependencies.

Recovery: existing annotated verified/sales-requested-split-20261020 remains the protected split checkpoint; exact preceding runtime c9bd6d6, Wix entry fcc7d66 and release record 5e32056 remain untouched. Do not restore an older global tag over later protected work.

## Evidence and implementation

- purchaseOperationJournal.js uses a fixed company/PURCHASE LOCK id, unique insert, PREPARED and RESULT receipts. Planner, Warehouse receiving, customer fulfilment, Sales adjustments and stock exceptions/resolution use this same company scope. Existing adapters use insert, not an upsert, with consistent reads. Thus no new lock service is justified by the inspected code.
- Wix official insert contract rejects duplicate _id and cannot overwrite an existing item: https://dev.wix.com/docs/velo/apis/wix-data/insert . Direct page fetch exceeded tool content limit; indexed official documentation returned the method contract. No live concurrent CMS writes were performed. Offline tests model this unique-insert contract; they do not prove actual deployed hooks/storage configuration.
- readWarehouseReceipts is physical supplier-receipt authority; readWarehouseTask marks transfer-only recipient tasks hasPhysicalReceipt:false. Split shipment mothers remain display/demand identities, not additional source receipts.
- stockPosition applies actual dispatch, quarantine, replacement and resolution records. Its availablePhysical is USABLE on-hand, not all goods physically held. Finance closing a loss does not establish physical destruction/removal. Candidate intentionally does not call this total physical On Hand or invent disposal/expiry/location data absent from existing receipts.
- readAllocations supplies explicit lifetime customer-source claims; readCustomerShipments supplies Support reservations/invoices/dispatch. Outstanding claim = allocation minus actual dispatch; shipment hold is a subset, not a second deduction. Excess holds and unknown source identity block confirmed availability.
- warehousePreparation.readyStockFor still gives an original customer entitlement to own-source physical stock, even without explicit planner targets. Therefore empty/missing explicit allocation is not sufficient proof that stock is free. This is a reconciliation gap between the inspected projections, not evidence that the user's production stock is currently wrong.

New isolated stockCardProjection.js consumes a trusted server-projected company workspace and complete Activity snapshot. It imports the existing authorities, does no store access, and has no production consumer or exposed endpoint. It groups real physical source receipts once by company/barcode/packing/EA. It includes residual stock under archived customer tasks. Incoming P.O. quantity is separate and never added to usable stock. Products without physical receipts create no Stock Card item.

Candidate reports received, dispatched, usableOnHand, explicit outstanding reserved, shortage, incoming and source details. `available:null` means REVIEW REQUIRED, not zero and not free inventory. Missing ownership, legacy unknown owner share, shortage, incompatible target, shipment overdraw or stale stock snapshot prevents presenting an available quantity. `unassigned` is diagnostic and must not be relabelled Available in a UI. No persistent implicit reservation is invented. Existing product/PO/receipt/split behavior is unchanged.

## Checks

First focused run: 30 tests passed, 0 failed across new stock-card-save-safety and existing planner-allocation, warehouse-ready-stock, warehouse-receiving, customer-fulfilment, stock-workspace tests. New six checks cover concurrent employees, both reading no lock before unique insert, real competing allocation/stale retry, lost acknowledgement recovery, crash-left lock retention and company isolation/payload replay.

New projection: 10 tests passed, 0 failed. Covers 120 received/100 reserved/20 available; unknown ownership; empty targets not silently releasing own-source entitlement; selection/invoice no physical deduction; dispatch deducting once; 40 claimed/35 usable/5 short; transferred/split stock counted once; 6000 nonstock products create no items; company/carton/incoming separation; cached quantity mismatch. Projection tests rerun after adding the conservative own-source entitlement gate, with all 10 passing. Existing 30 unchanged tests were not rerun for a summary. git diff --check passed.

All fixtures are in-memory/synthetic. No actual user order, PO, receipt, stock allocation, invoice, payment or chat was saved. Actual per-task Credits UNKNOWN.

## Production gates before connecting the candidate

1. Fresh live Wix comparison for the specific workspace/authentication/entry files before any existing source patch. Current release artifacts are recovery evidence, not a substitute for this fresh comparison.
2. Resolve customer-specific received-stock ownership using current procurement customer shares, demand revisions and planner events. Empty targets must not expose stock still considered Ready for the original customer. Preserve original P.O.s and immutable receipts. Do not introduce a second competing reservation authority.
3. Establish read endpoint authorization from server staff records. Warehouse/Purchase views must not receive Finance valuation/private fields by browser-only hiding. Account UI English; Warehouse/Purchase bilingual, no slash separators.
4. Show unknown/review-required quantities honestly and handle review per source/product. A product's unknown Available must not be silently aggregated as zero or omitted from a supposedly complete total.
5. First view may reuse one existing authenticated snapshot for reconciliation. This does not solve production-scale full-Activity replay. Before declaring scalable completion, measure existing query/page size and define an incremental, versioned current read model/rebuild checkpoint. Do not add a second movement ledger or per-department snapshots.
6. Costs require confirmed actual procurement basis, currency and cost coverage. Current mutable reference/netCostCtn is not a financial inventory valuation policy. Preserve unpriced quantity and do not report missing costs as zero.
7. Existing permissions require Admin stock-loss/release approval plus different Finance verification. User's requested Finance management model requires a separately explicit minimal policy patch in that stock workstream; do not silently bypass current controls.
8. Crash-left locks deliberately fail closed; no automatic age-based deletion. Recovery must inspect original receipts and preserve same request identity. No stale-lock deletion was performed here.

## Intended CMS economy

No new collections or items in this stage. Product master remains one authority; future current balances are lazy per company/product specification/real location, source/batch detail reuses actual receipts where sufficient. Current reservation relationships have stable identities. Existing real receipt/dispatch/adjustment events remain recovery/audit authority. No daily snapshots, carton-level rows, click Activity, duplicate stock-movement copies or unbounded history arrays. Lifetime product/batch/history counts can grow; do not promise a fixed 200 rows or guaranteed quota lifetime.

## Release status

- Code: local offline read-model candidate and focused checks; not integrated.
- GitHub Pages: not deployed for this task.
- Wix Studio: untouched for this task.
- Public Stock Card: not yet present or verified.

Efficiency exceptions: initial scoped lookup used nonexistent guessed filenames and invalid Windows wildcard paths, then corrected using a single backend filename inventory and exact file paths. Some combined output was truncated; necessary source ranges were subsequently obtained with bounded reads. No repeated blind tool retry or whole-project scan. These errors are not claimed as efficient operations; no task-specific Credit attribution is available.
