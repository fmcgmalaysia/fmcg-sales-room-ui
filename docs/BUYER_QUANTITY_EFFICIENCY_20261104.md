# Buyer quantity save efficiency

Approved objective: preserve individual quantity saves and receipts, coalesce their workspace readback, avoid preparing quantity-independent My Selection Excel after quantity edits, and preserve one-click review through blur/save races.

## Baseline and scope

- Branch starts at ae151e8, Sales runtime 1c83490; recovery tag verified/customer-file-download-20261103 protects its narrowly verified Sales download behavior only.
- Fresh Wix Buyer page clipboard export matches buyer-room/wix/buyer-room-page.js (normalized line endings). Fresh public Buyer HTML matches buyer-room.html. Copies retained outside checkout under handoff/buyer-quantity-efficiency-20261104.
- Exact current source is recoverable from ae151e8 and the live copies. Preserve all 100 other static resources from Pages #339 manifest, not stale working-tree equivalents.
- Two runtime files only, plus Buyer version marker and release packaging. No backend, CMS schema, quantities, quotes, transaction records, file delivery, authentication, or download lightbox changes.

## Minimal path

1. Send each quantity receipt immediately; wait for all overlapping quantity writes before one workspace readback. If a write finishes during a read, invalidate the older read and run a follow-up. A failed readback must not turn a confirmed successful quantity save into a failed-save receipt.
2. Exclude only quantity and mutable audit fields from the existing selection export invalidation key. All other selection fields still invalidate it, and expiry/renewal/native download stay unchanged. Export backend already reuses files by content hash; this reduces preparation work, not proven file or CMS growth.
3. Capture review intent on primary pointer down before input blur/readback can steal focus. Keep click handling for keyboard/assistive activation, with a guard against opening review twice. Existing draft validation, pending-save barriers, save-error handling, order request IDs and final submit checks remain.

## Acceptance

Test simultaneous/out-of-order writes, an already-running periodic read, a later write during readback, a failed quantity save, failed readback after successful save, unchanged export key for quantity-only changes, changed quote/product/selection invalidation, expiry and native download, pointer/click duplicate intent, invalid quantity and failed save. Public checks must not replay the two submitted test orders; use a separately identified authorized test draft and explicit result checks.

Do not bundle old QD publication filtering, Sales feedback, empty-state copy, review sorting, order-Excel delivery redesign, full-history CMS migration or cosmetic cleanup into this patch.
