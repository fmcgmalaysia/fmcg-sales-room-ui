# Independent Quotation Desk

This folder contains the Google Apps Script for the new one-customer-per-file Quotation Desk.

## Current source

- `QuotationDeskToolsV3.gs` contains the QD workflow, sorting and Wix sync logic.
- `QuotationDeskCore.gs` is the compact live menu/edit/sorting core shared by `WIX QUOTATION` and `DRAFT 草稿区`.
- `CatchCost.gs` is the independent, production CATCH COST module.
- Google Sheet header row: 5.
- Hidden formula row: 6.
- First product row: 7.
- Supported quote states: `RFQ`, `VIEW QUOTE`, `FAILED`.
- Product and cost source: WIX POINT BASE.
- Selection, quote and order workflow source: Wix CMS.

## Removed old behavior

- No customer tabs in one spreadsheet.
- No `updateAllCustomerSheetsFormulas()` menu action.
- No `WAITING` or `HOLD VIEW` state.
- No hard-coded old Point Base column positions.
- No status timestamp stored in a QD column. Wix CMS owns workflow history.

## Cost model

- CATCH COST copies source fields only through `DISC 3`; it never copies `NET COST /CTN`.
- Hidden row 6 owns the QD `NET COST /CTN` array formula: `ROUND(LP/CTN × (1-DISC1) × (1-DISC2) - DISC3, 2)`.
- `COST HEALTH` compares the QD-calculated net cost with WIX POINT BASE `NET COST /CTN` to two decimals.
- Any mismatch is red. Inactive/discontinued is black. A matching cost uses the Point Base freshness light.
- One run accepts 1–100 consecutive QD rows.
- The module uses one barcode-column scan per Point Base tab, bounded match windows and batch writes.
- It never changes `QUOTE STATUS`, dropdown validation, chip colours, formatting or the QD net-cost formula.
- The completion dialog reports stage timings and total elapsed time.
- After CATCH COST establishes a Point Base reference, manual changes to EA or cost inputs immediately recheck `NET COST /CTN`; a mismatch turns `COST HEALTH` red.
- Cost reference data is stored invisibly in document properties rather than exposed inside cell notes.
- A green `COST HEALTH` cell has no note. A cost mismatch keeps the compact bilingual system-cost note per PC and per CTN. When the QD cost still matches but the authoritative system cost is more than 30 days old, the red-light note instead shows a bilingual overdue warning with the actual number of elapsed days and instructs the salesperson to inform Admin; the visible note does not name Point Base.

### Draft sheet mode

- The same CATCH COST command detects columns from row-5 headers, so the Draft and formal quotation layouts may use different column positions.
- Draft intentionally has no `COST HEALTH`. A barcode found in Point Base refreshes its product/cost fields; a missing or blank barcode is retained as a manual product without a red warning or data clearing.
- Draft and WIX QUOTATION share one sorting command. Point Base products sort by projected `SORT NO.`; manual Draft products with no sort number remain at the end in their existing relative order.
- Draft row 6 is the hidden formula row. It owns LP/CTN, Net Cost/CTN, Quote/CTN, Profit, GP, CBM/CTN and Sort No. spill formulas; data begins on row 7.
- Draft `P6` projects `CBM /CTN` from WIX POINT BASE column T by matching `UNIT BARCODE` against column F across FOOD, NONFOOD and OTHERS.
- Draft summary cells use `C1 = ROUND(SUMPRODUCT(ORDER QTY, QUOTE $/CTN), 2)`, `C2 = ROUND(SUMPRODUCT(ORDER QTY, PROFIT (MYR)), 2)`, `C3 = SUM(ORDER QTY)` and `C4 = ROUND(SUMPRODUCT(ORDER QTY, CBM /CTN), 4)`.
- Wix quotation synchronization remains exclusive to the formal WIX QUOTATION page.

## Sort model

- The visible header is `SORT NO.` because this value is a mutable display order, not an immutable identifier.
- Hidden row 6 owns the spill formula that looks up Point Base `SORT NO.` by `UNIT BARCODE` across `FOOD`, `NONFOOD` and `OTHERS`.
- CATCH COST never reads, copies or writes `SORT NO.`. The formula remains the only QD source for this column.
- The QD sort action reads the projected `SORT NO.` result while keeping the formula-owned column out of row writes.
- Each newly copied QD file needs a one-time Google Sheets `Allow access` connection for the `IMPORTRANGE` formula. This permission cannot be granted automatically by the formula.

## Profit model

- Hidden row 6 owns the spill formulas for `PROFIT (MYR)` and `GP`.
- `PROFIT (MYR) = (QUOTE $/CTN × FX RATE) − NET COST /CTN`.
- `GP = PROFIT (MYR) ÷ (QUOTE $/CTN × FX RATE)`.
- In the current template this maps to `O = (N × $D$4) − L` and `P = O ÷ (N × $D$4)`.
- Blank quotations stay blank and profit is rounded to two decimals.

## Wix sync contract

The script sends only rows deliberately marked `VIEW QUOTE`. A successful row remains `VIEW QUOTE`; a rejected or failed row becomes `FAILED`; `RFQ` rows are untouched.

Before live sync, add these Apps Script Properties to the template project:

- `WIX_QUOTE_SYNC_URL`
- `WIX_QUOTE_SYNC_TOKEN`

The Wix backend must accept the documented JSON payload and return either a successful top-level response for all rows or per-row `results` keyed by `wixMyListId`.

`SpreadsheetApp.openById()` removes the `IMPORTRANGE` Allow Access step from cost refresh. The user running the menu still needs Apps Script authorization and permission to read WIX POINT BASE. A central deployment that executes as the system owner is the later production option if salespeople must not receive Point Base access.

## Deferred high-risk quote control

This is a frozen design rule for the later Wix–Google coordination phase. It is documented now but must not be added to the current QD build until the main quotation workflow is substantially complete.

- `QUOTE STATUS` remains a workflow field with only `RFQ`, `VIEW QUOTE` and `FAILED`. Cost changes must never push a customer-visible quote back to RFQ/Pending or remove it from My List.
- `HIGH RISK` is a separate, system-owned risk state in Wix. It is not a salesperson-selected QD status.
- Real `COST /CTN`, purchase cost, cost variance and other confidential cost figures must never be stored in Wix CMS, returned to page code or committed to GitHub.
- WIX POINT BASE converts the normalized current carton cost into a keyed, irreversible HMAC reference token. Wix receives only `barcode`, `costReferenceToken` and `costReferenceUpdatedAt` in the existing CMS CATALOGUE record.
- When a quotation is deliberately synchronized, its My List/quotation line stores the matching `quoteCostReferenceToken` as the immutable cost reference used for that quotation version.
- Wix determines risk by comparing `CMS CATALOGUE.costReferenceToken` with the quotation line's `quoteCostReferenceToken`. A mismatch marks that released line `HIGH_RISK` while the customer continues to see the last successfully published quote.
- The HMAC secret stays outside Wix page code, CMS and GitHub. It must be held only in an approved secret store such as Google Apps Script Properties. A plain hash is not acceptable because likely cost values could be guessed offline.
- Sales Room must show High Risk separately from New RFQ and Sync Failed, with a strong warning and a direct `OPEN QD` action. Sales Room must not reveal the underlying cost values.
- Risk does not clear merely because the QD cost later matches Point Base. It clears only after a reviewed replacement quote is successfully synchronized with the current reference token.
- High-risk detection belongs to the central PointBase-to-Wix/Wix-backend process, with one optional central audit job as a fallback. Individual customer QDs must not run independent periodic sync jobs.

