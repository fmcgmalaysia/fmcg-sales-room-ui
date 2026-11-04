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

## Release preparation

The two minimal Wix drafts have been read back exactly. GitHub synchronization, Wix publish receipt and real-page order/Excel acceptance remain required. No Pages deployment or temporary deployment permission is required because all 101 static resources remain unchanged.

Formal acceptance must use a fresh test request, never replay an old request ID. Record any resulting test addition explicitly and do not transfer it to MASTER, receive goods or post payments for this UI task. Historical PDF and CMS long-term-read issues remain separate.
