# Late original receipts after borrowed fulfilment

A customer's demand can already be covered by its original receipt and confirmed matching allocations from other sources. When the original PO's remaining cartons arrive, Stock List previously required the full original customer share again, even though Purchase correctly treated the excess as free stock.

The isolated patch deducts confirmed allocations from other physically received matching sources before checking the original source's remaining customer entitlement. It preserves review for missing ownership, incomplete outside coverage, unreceived or mismatched sources, quarantine and inconsistent snapshots. It changes only the read projection; receipts, PO quantities, source claims, borrowing responsibility and Loaded remain unchanged. Warehouse and Finance consume this same projection.

Recovery: runtime26ff1a1 / release record9e39cd8; the exact fresh Wix stockCardProjection.js matched the repository before editing (SHA256 838c722a8f7c59624a7734162296ab8ed214c0f24681d8b97ad7e6ea914ca432). Separate live receiving patch fc76b37 must not be replaced. This is a technical recovery point, not a new user-verified baseline.

Validation: the new valid-coverage test fails on the original projection; three focused cases and the existing stock/allocation/short-load suites pass, 70/70. Four real-backend memory scenarios now agree with Purchase: after remaining receipts and repayment, continue/transfer end at120 on hand,100 reserved,20 free,MYR7200; cancellation140/100/40/MYR8800; mixed125/100/25/MYR7600. Missing ownership protections still pass. Receipt inputs were seeded; no production business writes or actual receipt endpoint mutations were used.

Publication pending. Backend-only patch; no static asset or page version change is required. Verify existing public assets remain exact, synchronize this single Wix hunk, obtain published/live receipt and check Warehouse/Finance/Purchase. Keep this task separate from journal recovery and do not merge into main before user acceptance.
