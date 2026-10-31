# Purchase receipt and allocation Info

Approved2026-10-31 MYT: English-only compact RCV/ALLOC presentation, two Info entries for original receipt batches and confirmed allocation sources. This is one read-only presentation objective. Recovery runtimee8e988a/recordeb2484b/build20261031-purchase-active-clarity-v1; private exact Wix originals and public six-resource comparison are in root handoff/purchase-receipt-allocation-info-20261031. Live Purchase page, purchaseProjection.js and purchaseWorkspace.web.js match the repository exactly. Live warehouseReceiving.js separately matches protectedfc76b37 and must never be overwritten from this checkout. The two inherited LF-only changes are excluded. Main stays untouched; historical verified tags retain their original limited scopes.

## Minimal path

- purchaseReceiptInfo.js reads the existing validated readWarehouseReceipts chain. It maps original cumulative-before differences, identity, date and staff to read-only details. No queries, journals, collections or writes are added. Rejections and corrections remain distinct; a correction is not presented as another delivery. Borrowing never becomes a supplier receipt.
- purchaseWorkspace.web.js appends receiptHistory to its final response only after the original PO versions, financial state and progress have been computed. No common Purchase projection, Warehouse writer, allocation planner, borrow/repay logic, payment lock or cross-site interface changes.
- The composed static release adds task-info.js and changes only task-grid.js, task-grid.css, active-layout.js and Purchase index. All other93resources remain byte-identical. Original app.js and customer-allocation.js stay exact. Use the existing layout observer; do not create another refresh/observer/save mechanism.
- Info is read-only and separate from the existing allocation and receipt-issue actions. A single active table layout pass preserves Info when clearing old supplier-source buttons. Existing action controls and all write handlers remain in place.

## Display and boundaries

RCV shows original procurement physical receipts, excluding borrowed or ready-stock allocations. Two real deliveries170and30 show cumulative200 with170+30 beneath. A receipt170 plus borrowed30 shows RCV170 and ALLOC200 with PO170+Borrowed30. Source classification uses existing source task identities, allocations and loan responsibilities, never barcode guesses. Outstanding and Repaid use the original responsibility ledger.

For a shipment already Loaded and subsequently repaid, original source attribution remains as recorded; borrowing is labelled Repaid and responsibility is zero. Do not rewrite shipment sources as if the original goods had never been borrowed. Split rows keep their existing batch RCV amounts and mark the Info receipt history explicitly PO-level; whole PO receipts must not be duplicated as batch-specific arrivals. Missing legacy history is not reconstructed. Real0 stays0. Multiple receipts are collapsed to a compact count; signed corrections are labelled Correction and Adjusted. Receipt counts do not imply supplier waiting, financial closure or permission to allocate quarantined goods.

RCV caption is PO receipts (covers multiple supplier POs); ALLOC caption is Sources. New labels and Info dialogs are English only. Existing unrelated page labels are preserved. Normal completed quantities use pale display styling; Info stays a blue underlined action. The original ALLOC warnings and resolution actions are retained.

## Acceptance

Test170+30versus170+borrow30, completed repayment, ready stock, corrections, rejected-only/zero receipt, three deliveries, duplicate-event protection, missing history, multiple source POs, split Desk batches, NCT/GHR scoping and unchanged business versions. Regression-test original allocation, borrow/repay, receipt and shortload flows. Only synthetic memory fixtures may be written for this task; public acceptance is read-only.

Four release stages, exact permissions restoration, runtime/version marker and real page evidence must be recorded separately before claiming publication. Keep a draft PR and do not merge main before user acceptance.

## Pre-release results

15new checks,86existing business regressions and33receipt/allocation regressions pass. All97current public baseline assets match after newline normalization (93byte-exact). New scoped package contains98assets:4modified and1new;93unchanged. Native local candidate verified split receipts200with170+30, receipt170withALLOC200andBorrowed30, and repaid source30with outstanding0. Info exposes original date/time and staff, read-only. Real0is kept beside the original allocation warning, whose action remains unchanged. The original layout observer preserves Info across repeated parent-row cleanup; no extra observer or API request is created.

The first Info release02b6a51 reached Pages run41176277325 and Wix published/live. Public Info correctly showed real170+30 batches and the repaid30 plus originalPO170 sources, but public acceptance failed: the new uppercase `ALLOC Qty` caption broke the unchanged DeskDelivery case-sensitive `/Alloc Qty/` header lookup, hiding Loaded. Business records were unchanged. Feature edits stopped immediately.

Recovery completed before any compatibility fix: scoped run41177315597 restored the previous97assets (97normalized matches,93byte-exact), the exact original Wix page and workspace were published, and fresh public LAW/NCT acceptance showed TESTING01 Alloc200/Loaded200 and TESTING02 Alloc500/Loaded500. Temporary branch permission was removed and the original seven rules and zero tags verified.

Candidatev2 preserves the original `Alloc Qty` spelling. No DeskDelivery code, writer, stock logic or backend change beyond the original approved read-only history append is introduced. A new integration check executes the Info header decorator followed by the unchanged real Loaded decorator; it first failed onv1 and then passed onv2, covering normal200, shortload90 with issue color, zero, duplicate render prevention and preservation of the Info action. Sixteen Info checks and86business regressions pass;17receiving/review checks were rerun, with the earlier33receipt/allocation result retained. Local memory fixtures also exercise borrowed30, receipts170+30, outstanding0 after repayment and Loaded alongside Info. Version20261031-purchase-receipt-info-v2 awaits a separately approved scoped deployment, Wix publication and fresh public acceptance. Do not merge or labelv1 user-verified.

## V2 public release result

Runtime7f80f70, build20261031-purchase-receipt-info-v2: scoped Pages run41178105867/job124469756098 succeeded once;98of98public resources match after newline normalization (94byte-exact). The temporary branch rule was immediately removed and the original seven branches and zero tags verified. Wix confirmed published and live after exact draft readbacks. A fresh native root MASTER page, LAW/NCT, verified real TESTING01 AJAX cumulative200 with170+30 original dated/staffed receipt entries, repaid30 plusPO170 allocation and outstanding0, alongside Loaded200; TESTING02 retainsPO470+Replenished30 and Loaded500; TESTING801 LAYS retainsAlloc100/Loaded90 with the original red issue class and real70+30receipt entries. No captured errors and no business writes. All four technical release stages pass; user acceptance remains pending, main unmerged. The subsequent ETD/date/Requested visual request is a separate task and is not included in this release.
