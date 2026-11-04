# Buyer order confirmation without Excel waiting

Objective: a confirmed order must be acknowledged immediately; preparing or downloading its Excel receipt must not decide whether the order succeeded.

## Baseline and minimum patch

Base record `815ace43`; recovery tags `verified/buyer-selection-excel-20261104` and `verified/buyer-selection-image-links-20261104`. Fresh Wix Buyer page matched the repository; Order Received popup differed only by its trailing newline, retained in the exact live-derived draft. Public static baseline remains the 101 resources from Pages341 / `4bc463e`.

Two Wix frontend files only:

- Buyer page acknowledges the original successful submission immediately, opens the existing Order Received popup, and catches subsequent readback/popup failures separately. A failed or unconfirmed submission still receives a failure result.
- The original popup prepares Excel only after the customer clicks Download Order Excel. It disables repeated clicks while preparing, validates the returned order identity and file, and offers Retry Excel Download after a preparation failure. It returns the file through the existing popup close response; the Buyer page sends the original `BUYER_ROOM_DOWNLOAD_ORDER_EXCEL` event to the unchanged Blob downloader.

No new endpoint, storage, collection, order writer, polling mechanism, file format, share permission, authentication change or automatic retry of submission. The existing authenticated `createBuyerOrderDownload` and all backend sources are unchanged. Closing the popup without requesting a download performs no order Excel preparation. The existing native popup identity, close control and download button IDs remain unchanged.

Wix documents the popup response as the result of its programmatic close operation: [official lightbox close API](https://dev.wix.com/docs/velo/apis/wix-window-frontend/lightbox/close). No parent-to-popup messaging or new synchronization system was introduced.

## Tests

102 Buyer CJS checks passed. Ten new cases cover immediate acknowledgement, failed submission, post-confirmation readback failure, popup failure, closing without download, matching file handoff, slow preparation/double clicks, retry after Excel failure, mismatched/incomplete files, and absent order context. Existing backend submission idempotency, immutable Excel receipts, customer authorization, quantity saves, My Selection Excel links and the browser file downloader remain covered.

Two old quantity-release assertions were updated for explicitly approved subsequent changes: the independently published Sales layout and this receipt-timing change. Protection still verifies unchanged native download blocks, unchanged Buyer confirmation click handler, and byte-identical backend authority/workbook code against the accepted source.

## Candidate release and failed public acceptance

Code `70b33f33` is synchronized in PR341. Both minimal Wix drafts were read back exactly; Studio returned published and live. All 101 current static resource hashes were rechecked and remain unchanged, so no Pages deployment or temporary deployment permission was used.

The user subsequently opened TESTING 801 and explicitly authorized one fresh addition: 1 CTN of 7UP for USD9.60. Final Send Request was clicked once. Receipt suffix `434735C26F33466EB863967FED679C69` was confirmed; active 7UP changed from 100 to 101 CTN, AJAX stayed 100, and exactly one order-change history row appeared. No transfer to MASTER, receipt of goods, payment or replay was performed.

The original native Order Received popup was not observed. The user explicitly stated they were working elsewhere and had not watched or closed it. The Excel download was therefore not verified. Treat this as failed acceptance, not a successful release. Passing 102 offline checks did not establish native Wix popup behavior. The exact cause remains UNKNOWN; an empty browser-console capture is not proof that no Wix worker error occurred.

## Recovery completed; public recovery check pending

Following the recovery-first rule, both production Wix files were restored with isolated reverse patches and read back exactly equal to their pre-task live originals. Wix returned a second explicit published-and-live receipt (21:18 MYT). Local production sources and the original popup test have also been restored to `815ace43`; the failed candidate's ten new tests are removed from the active branch but remain recoverable in `70b33f33`. The restored Buyer suite passes 92/92 checks.

Private evidence is retained under `C:/FMCG-WIX-LOCAL/handoff/buyer-order-confirmation-20261104/`: exact before/after/restored sources, both publish receipts, test-transaction JSON, screenshots and test output. The authorized addition remains recorded as 101 CTN; recovery did not change business records. No static deployment or permission change was needed for either operation. Do not resend the request to obtain another popup attempt.

Wix historical logging was not connected before this event. The available Wix Logs view starts with real-time interaction and contains no retained 21:09 error. No new logging integration or permissions were added. Further work must obtain concrete popup-lifecycle evidence from the restored baseline before another implementation. Historical PDF and CMS long-term-read issues remain separate.
