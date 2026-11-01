# Sales Department — implementation and acceptance

2026-11-02, Asia/Kuala_Lumpur. Candidate on feat/sales-department-20261102, based on customer-invoice checkpoint5b0fe72. Not deployed.

## Placement and authority

A separate Sales Department workspace opens from the authenticated Sales Room menu. It reuses the existing StaffMaster staff context; it does not create a second login system or copy the customer directory to MASTER. Every request freshly resolves current staff and reads WixCustomers assigned to that exact employee. Existing admin view-all privileges do not widen this directory. Client-selected staff/customer scopes are ignored. MASTER returns only that authorized scope over the existing authenticated server bridge; NCTActivity and NCTActivity1 stay separate. Buyer history receives no new cost fields.

Dashboard columns: Customer full name, Country, Currency, Term, Current Due, Entry. Customer header contains profile/contact/address, currency, term and current balances. Customer table columns: Period, Invoice No./date, Invoice Amount, Payment Status, Cost MYR, Profit MYR, GP, Transport, Comm Status. Commission columns: Period, Inv, Amount, Cost MYR, Profit MYR, Others Cost, Net Comm.

## Data and calculation boundaries

- Due comes from the same Finance ledger and explicit invoice allocation relations. An unallocated customer deposit does not magically settle an invoice. Different companies/currencies never offset on the screen.
- Goods cost is the issued invoice's saved costSources quantity×netCostCtn, excluding transport. Revenue MYR uses the issued invoice amount and saved invoice FX. Profit is revenue less purchase cost; GP is profit/revenue, two-decimal percent. No current POINTBASE or current FX request rewrites the past.
- This is invoice-FX profit, not a claim of final bank conversion profit. Actual realized FX, incomplete FOC cost composition and missing historical snapshots remain separate Finance/data concerns. Missing cost remains unknown. CN/DN-adjusted invoices require Finance review; profit/GP are not guessed.
- Fully settled invoices with actual matched receipts remain in the Commission review list, including records requiring cost/adjustment review. Settlement never automatically marks commission paid.
- Comm Status initiallyPending. No Finance commission posting source currently exists; this scope does not invent an amount, commission rate, payout, reversal or employee ownership at historical reassignment. A future authoritative Finance payout can supplyPAID; the UI supportsComm. Paid. Others Cost/Net Comm and Transport remain blank as requested.
- Customer terms have no currently populated authoritative field. The reader accepts only requested values from WixCustomers.paymentTerm:30% +70%,Cash,7 days,14 days,30 days. Missing or unsupported values remain blank; supplier terms are not substituted. Term editing authority/source population still needs a separate decision.

## Efficiency and safety

One assigned-directory read and one activity read per company cover the portfolio, rather than a query for each customer. Existing complete ledger projections remain the authority. The API rejects more than200 customers rather than silently truncating; larger portfolios need a separately measured paging contract. Internal page navigation reuses fresh data; only an open, visible workspace polls once per minute. Requests cannot overlap; timeout retains the last confirmed view. Definite access denial clears private customer data. Opening, searching and navigating create no CMS business records.

## Acceptance

Focused tests cover exact ownership including admin, forged identities, company failure, scope validation, cash versus allocation, immutable cost/FX, unknown costs, CN review, customer entry's nine columns, two-decimal amounts/GP, hidden/closed polling, transient failure and access revocation. The runtime package extends the exact101-resource28bcf9a baseline to105 resources,13 changed including the prerequisite transaction-history changes. Purchase, Warehouse, stock and retired Support entry resources remain byte-identical.

Code/test verification is independent of visual and public acceptance. Source-site staffAuth API reuse needs live read acceptance. The browser rejected local file previews; do not bypass that policy or report a visual pass. Both Wix editors currently stall during platform startup, and no new draft has been synchronized. No new receipt, PDF, commission payment or inventory transaction was made.

Required remaining stages: final combined regression; fresh live module/marker synchronization; GitHub Pages restricted deployment and build hashes; Wix published/live receipts; actual Sales/Buyer/Finance customer-file and per-invoice payment acceptance; Sales own-client and profit UI verification. User verification remains pending; do not merge main.
