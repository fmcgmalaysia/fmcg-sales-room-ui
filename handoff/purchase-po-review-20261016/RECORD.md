# Purchase P.O. review — 2026-10-16

User corrected the requested reference from Sales Review to Buyer Room Order Review, and supplied its screenshot. The implemented reference is Buyer Room's wide white modal, summary strip and compact line table. Sales and Buyer source files were read for reference only and remain unchanged.

## Scope and recovery

- Branch `style/purchase-po-review-20261016`, based on809959a. Runtime recovery point is the calculator-save-v2 front end at1706ef5, plus the Wix #html1 right-gutter geometry recorded in809959a. Existing annotated limited checkpoints remain unchanged; no new whole-Purchase verified claim or main merge.
- Fresh public app.js/style.css/index.html matched repository before edits; exact copies retained locally. Fresh full Wix page matched the previous v2 page; after synchronization the only page-code difference is the src version token. Backend, event IDs, save payloads, company isolation, permissions and iframe geometry remain unchanged.
- Files changed: Purchase app.js, scoped style.css, index cache/build marker, corresponding Wix src token, and existing UI regression tests. No new backend, Account/Warehouse integration or business record write.

## Behavior

- Existing P.O. numbers from Active/Room, supplier allocation and Purchase Order list open the same read-only Review P.O. modal. It includes every saved task with that P.O. and supplier in the current company, regardless of unrelated current row selection.
- Summary: distinct products, customers, total cartons and total MYR. The table includes barcode, descriptions, packing, customer, unit cost, quantity and amount. Uses existing procurement totals and stored costing cents, preserving FOC precision. Supplier remains prominent. Unknown optional CBM was not invented or added through a new data path.
- Review contains no editable P.O. field and no Confirm action. Closing does not save. An explicit Edit P.O. No. action opens the original number-association form with all members and their versions. Existing backend validation and save protections are retained.
- Unassigned P.O. and explicit selected-row creation retain the original confirmation/payload path. Existing dirty-source, pending-save and price/sequence draft guards remain. No actual number edit or new P.O. was submitted during this task.

## Verification

-110 relevant tests passed,0 failed: purchase-live-ui, allocation action colors/dialog/drafts/waiting, and source grid. New coverage checks complete grouping, isolation from other supplier/P.O., multi-customer/FOC exact totals, no write when reviewing, and explicit number edit with original member versions. Existing unassigned creation, partial Save, draft isolation and pending operations still pass. No unrelated baseline failure was patched.
- Reused the single existing local candidate window. A two-product sample P.O. showed110CTN/MYR5,280.00, no internal IDs or Confirm action, and the independent number-edit entry. This is sample-data visual verification, not a real new business P.O.
- Formal page refreshed only after all fields in the open saved35-box modal matched their initial values (including supplier, prices, quantity and blank reason), then closing it and confirming no Save/pending dialog. User subsequently reopened the formal tab; reused the new tab without opening another formal window.
- Fresh formal iframe points to purchase-po-review-v1. Clicking NCT-PO-8465621 from Active displayed KOH SOON HUAT,1 product,1 customer,20CTN and MYR1,321.05. No input or savePo control exists. Closing and opening from Purchase Order list produced the same review. Opening KINDER's unassigned P.O. still displayed the original Confirm form; it was closed without saving.
- Existing CHIPSMORE35 plus WAITING15 and ECLIPSE100 plus stock10 remained visible. A newly present customer task was user/external data, not created by this test. No CMS mutation, P.O. number change, supplier Save, payment or warehouse receipt was performed.

## Four publication stages

1. Code: front end ca0621b6741b0d560569c4bb4fc392c628f3d084; Wix source-pointer record3505ad7. Acceptance documentation follows in its own commit. Main unchanged pending user acceptance.
2. GitHub Pages: run38849177100 succeeded atca0621b. Marker2026-10-16-purchase-po-review-v1 verified;31 protected public assets matched repository. Temporary policy63230680 removed and original7 restored exactly. Cleanup initially targeted the previous release ID and made no deletion; corrected to the captured current ID and verified original policy set.
3. Wix Studio: exact full before/after readback proved only token changed; published/live receipt captured. #html1 width/right margin fix preserved. No backend edited.
4. Public page: actual new Review P.O., both existing-number entry points, close/reopen and unassigned confirmation entry visually/functionally verified without relevant error. Permanent URL https://fmcg999.wixstudio.com/master .

Local exact snapshots, test output and screenshots: `C:/FMCG-WIX-LOCAL/handoff/purchase-po-review-20261016/`. Selected hashes recorded in evidence-hashes.json; public-review.png is the real20-box P.O., preview-review.png is the two-product sample. The existing unrelated CRLF-only test-file change remains unstaged; unrelated files were not cleaned or committed.
