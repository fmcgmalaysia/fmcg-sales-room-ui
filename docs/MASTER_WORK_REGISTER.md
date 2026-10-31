# MASTER open work and product cost decisions

Updated 2026-10-31. This is the continuing register for unfinished work; reports and chat summaries are evidence, not a replacement backlog. Current production repair code is97f9623, acceptance recordbbe7785, draft PR266. This documentation branch changes no production behavior and does not approve the proposed cost migration.

## How to continue without losing work

- Read the project AGENTS.md, START_HERE.md, this register and the active item's evidence before implementation. Preserve the existing startup, live-comparison, recovery and four-stage publishing laws.
- Keep each ID when reprioritizing or moving between chats. Add the implementation branch, test evidence, release status and user acceptance to the same entry. Do not create a competing register.
- An item is not complete because code/tests/GitHub/Wix succeeded. Record Code, Pages, Wix, Public and User acceptance separately; document an explicitly inapplicable stage. Close only the exact accepted scope.
- Keep discussions as DECISION_PENDING until the user chooses the rule. A recommendation, example or documentation commit is not implementation authorization.
- At task handoff, update the active ID and next safe step in START_HERE.md. A new chat must use this workspace/record; conversational memory alone does not transfer the register.
- Do not manufacture a production crash to make every test row live. The38-row acceptance matrix distinguishes isolated failure injection, live variants, pending business decisions and user acceptance.

Private detailed evidence: root handoff/master-stress-closeout-20261031/REPORT.html, ACCEPTANCE_STATUS.json and LIVE_STRESS_STATUS.json. Repository acceptance: [confirmed recovery](ALLOCATION_COMPLETED_RECOVERY_20261031.md). Preserve independent live receipt fixfc76b37; the current checkout must not replace that complete backend file.

## Required follow-ups from the stress report

Priority P1 means potentially misleading work/financial interpretation or a critical unresolved business boundary. P2 means recovery usability or measurement. P3 means presentation. These priorities do not declare the existing stock ledger corrupt.

| ID | Priority | Owner | State | Evidence / exact gap | Acceptance condition |
| --- | --- | --- | --- | --- | --- |
| MST-01 | P1 | Purchase display | BACKGROUND_CANDIDATE | fix/purchase-allocation-origin-info-20261031 reads saved origin/return evidence;79 distinct checks pass. See PURCHASE_ALLOCATION_ORIGIN_INFO_20261031.md. Browser preview, broader regression, packaging, Wix and public acceptance remain pending. | Detail distinguishes20 free stock from60 borrowed using saved facts, not inferred barcode matching. Actual allocation, borrowing, repayment and stock do not change. |
| MST-02 | P1 | Warehouse operational information | APPROVED_SCOPE | User clarified 2026-10-31: customer PO is irrelevant to Warehouse. The prior proposal to fill that field is withdrawn. Warehouse Receiving keeps Purchaser-issued supplier PO; Delivery uses the authorized customer Desk, customer ETD and Last Gate In (date and time). | Receiving retains its supplier PO; Delivery removes customer PO from both its header and its API projection without relabelling it as a supplier PO. ETD and Last Gate In follow Support's current authorized Desk context. No prices, amounts, deposits or financial files reach Warehouse. |
| MST-03 | P1 | Support / Warehouse display | LOCAL_TESTED | Candidate branch fix/warehouse-effective-quantity-20261031 uses existing resolution.maximum for displayed Alloc. 61 distinct checks and local Chrome scenarios passed; no deployment yet. See WAREHOUSE_EFFECTIVE_QUANTITY_20261031.md. | Current executable quantities and remaining work are unambiguous; retain the original authorization evidence without implying another20 must load or deducting again. |
| MST-04 | P1 | Finance / Purchase wording | OPEN_FIX | Purchase request12500 is paid, while Finance final Payable/Balance is unknown pending independent reconciliation. | Request payment completion and final supplier reconciliation are clearly separate. Unknown is not0; payment does not auto-Audit or reopen PO. |
| MST-05 | P2 | Shared save consumers | OPEN_DESIGN | Stale receipt/Finance forms retain inputs but fresh-version recovery requires closing/reopening; company-lock conflict requires original Retry. | Preserve inputs and original operation identity while reconciling or explicitly reviewing a changed version. No blind new-request replay, lock removal or bypass of concurrency validation. |
| MST-06 | P3 | Finance files | OPEN_FIX | A supplementary payment file was named PAYMENT .pdf without the original payment reference. | Supplement uses the original reference; still3 payments/4 files/total12500 and first-payment lock. No new monetary record. |
| MST-07 | P3 | Warehouse receiving | OPEN_FIX | Missing-reason error lingers after choosing a valid waiting reason. The selected label does auto-populate reason and Confirm succeeds. | Clear only resolved validation feedback; keep partial/rejected/correction guards. Do not expose an unnecessary second reason field. |
| MST-08 | P3 | Finance wording | OPEN_FIX | Purchase labels the expected shipment date ETD; Finance labels the same date ETA. | Use ETD for that date without changing stored dates or actual arrival fields. |
| MST-09 | P2 | Backend measurement | OPEN_MEASUREMENT | No before/after full CMS collection counts or production networkp95 were measured. In-memory5000-event CPU benchmark is not online capacity. | Measure per-action collection deltas and read/query latency; distinguish business facts, PREPARED, RESULT, locks and disposable test rows. No history deletion or replacement ledger without a separate approved plan. |
| MST-10 | P1 | Cross-department acceptance | OPEN_ACCEPTANCE | Fresh live core chain passed;38 original rows include variants/fault injection not all performed live. Original801100/90/10 remains for the user. | Track exact matrix coverage and user test results. Do not claim all38 passed or merge unverified feature history to main. |
| MST-11 | P2 | Product read mapping | DECISION_PENDING | FMCG sync has netWeight and pointBaseSortId; current MASTER intake does not map them. Current MASTER CBM reference is separately captured from POINTBASE. | Define authoritative metadata, weight units, stable product linkage and historical snapshot behavior before a minimal field-mapping task. Catalogue/selection/QD identity remains protected. |

MST-01 through MST-04 and MST-10 should be resolved/accepted before declaring the full workflow ready. MST-05 is an explicit usability follow-up. MST-09 is required before promising production scale. Cosmetic rows remain visible work, not a reason to migrate the entire system.

## Cost route decision

**COST-D01: DECISION_PENDING. Recommendation: POINTBASE becomes product-information input; MASTER Purchase owns all active supplier reference-price and promotion management.** Do not retain two editable reference-price authorities. FMCGMALAYSIA keeps its current Catalogue, images, customer selections and QD identity; MASTER reads the authoritative product metadata. No full Catalogue/image migration is proposed.

The alternative is to keep POINTBASE as the sole reference-price authority and make MASTER only a reader. That is a different route and would require adding promotions, effective dates, tiers and receipt boundaries to POINTBASE. A hidden MASTER override or permanent bidirectional price sync would create two competing authorities and is not recommended.

Current facts: [supplier-allocation](../purchase-live/supplier-allocation.js) and [calculatePlanCosting](../integration/backend/purchasePlan.js) already represent paidCtn,freeCtn,totalCtn,amountCents and averageCostCtn for a single PO source. They do not establish a complete supplier offer library. [Finance stock valuation](../integration/backend/stockValuationService.js) explicitly returns FOC_RECEIPT_UNCONFIRMED for incomplete FOC receipts because receipt composition is not recorded. Existing [Stock List scope](COMPANY_STOCK_LIST_20261031.md) excludes freight, tax, later credits and write-downs. Full live FOC100+10 split-receipt acceptance remains pending in matrixQ03.

## Proposed MASTER cost-management behavior

| ID | State | Proposal / boundary | Acceptance example |
| --- | --- | --- | --- |
| COST-01 | PROPOSED | Per product, supplier and applicable company, store effective dates, original paid-carton price, discounts, MOQ, paid/free quantities, promotional SKU and explicit tier conditions. Reference revisions are not PO edits. | Two suppliers and100+10 versus200+30 remain distinct eligible offers, with original terms available. |
| COST-02 | PROPOSED | Reuse one existing purchase-cost calculator; do not store a second manually editable effective unit cost. Persist total money at cent precision and original quantities; display derived unit costs without multiplying an early2-decimal rounding. | Same-SKU paid priceMYR50:100 paid+10 free=110, total5000, average45.454545…;200+30=230, total10000, average43.478260… . |
| COST-03 | DECISION_PENDING | Define threshold versus full-bundle offers, highest applicable tier and stacking. Never infer proportional gifts or add two mutually exclusive tiers. |150 paid does not automatically receive15 free.200+30 does not become200+20 by repeating100+10 unless supplier terms say so. |
| COST-04 | P1_DECISION_PENDING | Separate quoted/expected blended cost from confirmed receipt cost. Record or verify paid/free receipt composition without adding another physical stock authority. Agree provisional cost, finalization and treatment of already-Loaded goods before coding. | PO100+10; only100 or mixed paid/free quantities arrive; gift10 arrives later or is cancelled. Physical stock counts only actual receipts. Do not silently reprice old Loaded/GP or treat unknown cost as0. |
| COST-05 | DECISION_PENDING | Different-SKU gifts, standalone free goods, supplier substitutions, credits and rounding need an explicit cost-allocation policy. Same-SKU averaging does not determine a different product's value. | BuyA receiveB cannot spread money across unlike cartons by simple count or assumeB=0. |
| COST-06 | PROPOSED | Copy the chosen offer and price version into the existing PO costing snapshot. Later reference-price changes apply to future drafts; preserve current amendment workflow and permanent first-payment lock. | New reference48 does not rewrite oldPO50, old stock cost, paid PO or locked sales quote. |
| COST-07 | P1_DECISION_PENDING | Identify every reference-price reader before one cutover: initial intake, Catch Cost, retries, QD initial fill/refresh and any quotation-cost/GP functions. QD template layout/formulas remain the protected live authority. | After cutover they use the chosen MASTER reference source; no silent POINTBASE fallback or second editable cost sheet. Choose the company/supplier/quantity assumptions for QD explicitly. |
| COST-08 | PROPOSED | Keep customer Catalogue/Buyer APIs free of internal procurement prices. Preserve NCT/GHR cost/stock boundaries and existing financial authorization. | Unauthorized Warehouse/Buyer calls receive no price/discount/amount/private documents, even if UI hides those columns. |
| COST-09 | PROPOSED | Auto-save offer drafts without enabling incomplete terms. Record an effective revision only when relevant terms change; reads and repeated identical saves create no price history. Explicitly enable a valid offer. | Browse/refresh/Catch Cost creates no new cost version; an ordinary one-off negotiated PO does not automatically overwrite the long-term reference offer. |
| COST-10 | DECISION_PENDING | Define quotation eligibility: a small order cannot assume an unearned200+30 purchase promotion unless existing stock or a confirmed sourcing plan supports that cost. | A quote for10 cartons does not silently use the230-carton blended promotional cost. |

## Migration gates if the MASTER route is approved

1. Confirm COST-D01 and the P1 rules, particularly partial FOC receipt/finalization and QD price basis. This register is not that approval.
2. Read exact live product, QD, central Apps Script and MASTER price-reader states; retain independent recovery points. Import and reconcile old reference data without changing the current active source.
3. Build the MASTER reference-management draft and reuse the existing costing core. Imported/draft data is inactive, not a second operational authority. Test normal,100+10,200+30, partial gifts, overdue gifts, supplier changes and quantity-dependent quote eligibility.
4. Cut all agreed active consumers to the single MASTER cost source in a separately approved release. Retire POINTBASE price editing from the active workflow; keep only an explicitly read-only historical record if needed. Product metadata synchronization remains separate and cannot overwrite costs.
5. Verify Catalogue/Selected→QD, quotation, Sales submit, PO, Finance, receipts, FOC cost finalization, allocation/borrowing, Loaded, Stock List and company isolation. Preserve the four release stages and user acceptance before baseline promotion.

Until these gates are met, current POINTBASE price reads remain active. No cost authority was switched by this documentation task.
