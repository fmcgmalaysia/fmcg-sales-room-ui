# Supplier bank details impact and acceptance

Scope: supplier bank fields and their dependent presentation only. Recovery243880c; production Purchase remains unchanged. Fresh live sharedSupplierOperations and Purchase Wix page matched repository before editing; public app.js also matched after newline normalization. Exact captured copies are under the root handoff/supplier-bank-details-20261017 directory.

| Surface | Behaviour |
| --- | --- |
| Create Supplier and Edit Supplier | Bank Name and Account No. in Company Info; existing save/profile route |
| Saved-profile conflict review | Both saved bank values included; existing revision/reapply mechanism retained |
| Account task identity and payable identity | Current bank beneath full supplier legal name |
| Review Payment | Read-only current recipient |
| Payment Plan | Read-only current recipient; no transfer execution |
| Record Payment | Read-only recipient captured with each saved mock payment |
| Pay Slip payment records | Recipient at payment snapshot, immutable after supplier edit |
| Historical payments without bank snapshot | Not recorded; never filled from today's supplier profile |
| File View and Download | No extra bank data or delivery changes |
| PO, customer and Warehouse projections | No new bank payload; unrelated workflows unchanged |

Field contract: bankName string max160; bankAccountNo string max64. Optional pair, trimmed, leading zeros and account case preserved. Reject control characters and incomplete pairs. No new collection or parallel synchronization.

Validation:8 supplier operation tests and132 supplier/Purchase/projection tests passed. Tests cover compatibility, replay, concurrency, old-client preservation and invalid input. Local Chrome actual supplier form mock save/reopen retained001234567890. Account preview displayed current bank in the task row and Review Payment; isolated payment checks proved snapshots survive later bank changes. No production business records were written.

Release state: candidate code only. No new GitHub Pages build, Wix write/publish or public bank-field acceptance. Account remains a synthetic memory-only discussion draft. Before real deployment verify two SharedSuppliers text fields and implement Account's approved finance-specific read/save contract separately; do not expose banks through shared customer/warehouse projection.
