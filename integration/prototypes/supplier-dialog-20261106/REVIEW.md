# Supplier split and Submit image release review

This patch keeps an amended 500-to-300 source and the remaining 200 separate. Choosing a replacement supplier no longer duplicates that remainder. Each source keeps its independent draft and existing save request. Explicit stock purchases do not cover customer demand. Saved PO sources render as text until the pencil is used; financially locked sources show a lock and no edit controls. Required transport and reason fields use the existing orange prompt treatment.

Product images are optional metadata captured by the existing Sales Submit snapshot. The source follows the authorized customer's selection record to its product ID, with batched lookups. It never guesses by barcode. The existing NCT/GHR intake and Purchase projection carry that URL. No new collection, synchronization job, inventory authority, or financial permission is added. Existing orders are not resubmitted or backfilled. Missing images do not block submission; retry retains the prepared snapshot.

## Validation

- 90 focused checks passed, including 500→300, isolated row save, financial locks, source costs, image mapping and NCT/GHR retries.
- 98 shared regression checks passed, covering delivery, cross-site submission, receiving, planning, operations and payment handoff.
- After the final stock-remainder summary adjustment, 36 affected checks passed; the stock-specific assertion was then rechecked with all 8 new scenarios passing.
- JavaScript syntax checks passed. The package changes 3 of 96 resources and preserves the remaining 93 hashes.
- Four backend Wix drafts have been read back and match the candidates exactly.
- Local browser preview was unavailable. Public visual acceptance is now recorded in PUBLIC_ACCEPTANCE.md; test counts alone were not used as acceptance.

## Protected baseline and live difference

Static base: 11ffe261, build 20261105-sales-quantity-save-response-v1, Pages run 42066329670. The exact live Purchase CSS appendix was retained with explicit user approval; it contains previously published PO spacing and Requested/date styles. All other inspected source files matched. Exact originals, drafts and test outputs are preserved under handoff/supplier-dialog-20261106 outside the checkout.

## Earlier acceptance checklist (completed; see PUBLIC_ACCEPTANCE.md)

1. Completed: Purchase version-only draft matched; both Wix sites returned published-and-live receipts. The ALLOC icon follow-up is code `0d19c3ab`, PR360, build `20261106-supplier-dialog-image-v2`, Pages run42152787762;96/96 resources matched and the original7 deployment rules were restored. The former request to open the MASTER editor is obsolete.
2. Verify plain saved rows, pencil editing, financial locks and independent draft retention in the public dialog without overwriting the user's open draft.
3. Verify a newly submitted authorized test order displays its catalogue image. Do not resubmit the prior AVATA one-box request reserved for Sales quantity testing.
4. Record actual public evidence and user test instructions; keep this branch unmerged until user verification.

## Background closeout while the user is away

Three additional image-boundary scenarios passed with the existing8 scenarios (11/11 total). They exercise the current code without production writes:

- 250 distinct selected products:6 bounded queries (100/100/50 selection IDs, then100/100/50 product IDs); original line order, quantities and prices preserved.
- 300 lines sharing2 selections and1 product:2 queries, all300 order lines retained.
- Malformed, foreign-customer and missing selections: valid owned images survive; foreign product IDs are not queried; inputs are unchanged.

These are isolated query-count checks, not Wix latency or capacity benchmarks. No new CMS collection, record, job or production-code change was introduced by this follow-up. Existing prepared Submit snapshots still bypass new snapshot construction on recovery. The previously passing NCT/GHR intake check covers interrupted intake and same-request retry without extra records.

Earlier blocker, subsequently cleared by foreground public acceptance: the new Purchase page points to v2 but remains blank after foreground inspection and one hard refresh. Do not repeat deployment or refresh the user's older tab with possible drafts. Remaining visible checks are saved-row styling, pencil/financial-lock presentation, orange ALLOC hand, and a future authorized new Submit carrying an image. Do not reuse the reserved AVATA001 one-box Sales test request for that Submit.
