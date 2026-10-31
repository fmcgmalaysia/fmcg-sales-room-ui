# Purchase source quantities and receipt review

Approved objective: correct two Purchase presentation faults without changing orders, POs, stock, borrowing, repayment, financial review or their stored records. The two isolated patches compose into one runtime; there is no second stock authority or saved display ledger.

## Evidence and recovery

The current Wix Purchase page was freshly copied in full and matches the repository. Seven relevant public resources match the composed production baseline. Runtime recovery is 6c62104, record45383a5, build20261031-purchase-alloc-layout-v1 and its exact Wix source. Existing annotated verified/sales-buyer-design-20261014 retains its historical design-only scope; this new work is not user-verified. Preserve the separately deployed receipt backendfc76b37 and two inherited LF-only working changes. Main remains untouched.

Read-only real evidence: TESTING02 AJAX ordered500, PO500, allocated500, Loaded500. It lent30 to TESTING01, then received30 back from PO01; its physical shipment sources are470 from PO02 plus30 from PO01. Finance Stock List currently reports AJAX onHand0, reserved0, available0, isolated0 and value0, with no remaining sources. The previous display counted the procurement500 and external30 as530. No ledger correction is indicated by this evidence.

AJAX TESTING01 received200/200 and LAY'S TESTING801 received100/100. Their historical receipt cases remain open for Finance, while physical shortage is0. Existing shared signals deliberately preserve these cases and original callbacks. Supplier invoices, document checks, payments and final Audit remain independent and must never be auto-completed.

## Source display

The Purchase-only stockCoverage projection subtracts confirmed cartons redirected from a customer's original earmark, allowing for genuine procurement extras before reducing that earmark. When another confirmed source supplies the customer, saved own-source ownership limits the own contribution; an unused original carton is not added again. Original procurement quantities, PO amount, unit cost and GP calculations are retained. Before first allocation, original procurement planning remains visible. Original saved batch bindings are used for transferred coverage, and external stock is still assigned only to its saved batch.

Where original quantity and current customer contribution differ, the numeric source column shows the contribution; the existing original procurement quantity button remains as a smaller PO figure with its original action. Product text explicitly states original PO quantity and customer contribution. A replenished source label requires an existing lender/borrower relationship and repaid quantity sufficient for this contribution; otherwise existing Ready Stock/Borrowed Stock/Stock review labels remain. The read-only box distinguishes customer-source quantity from the original source PO quantity. No save or edit is added.

## Receipt classification

Only the Purchase Dashboard presentation normalizes an open historical RECEIPT case to orange Waiting on others when its quantity is0, ownership is ACCOUNT, confirmed physical receipt covers the recorded plan, and no current receiving or isolated-stock issue exists. Text becomes Receipt complete; Finance review pending 收货已完成，待财务核对. Original action indices and task identities are retained. Shared task-signals and other departments remain byte-identical.

Full receipt does not suppress explicit facts: overpayment, changed reviewed documents, open document problems, unconfirmed payment results and payment-due flags retain red priority. A generic historical financialRisk flag alone does not prove current monetary loss. Missing payable amounts stay unknown. Real short quantities and current warehouse problems retain their existing red handling. Final Audit continues to clear work only through the original backend signal.

## Acceptance

New memory tests cover the actual470+30 scenario, borrower170+30, unrepaid30, stock extras, replacement from another source, partial/free/own extra stock, batch isolation, unchanged original PO/costs, read-only details, two completed receipts, true shortages, isolated goods, explicit monetary risks, missing receipt evidence and original callback identity. Existing allocation, split rows, Dashboard, borrowing, repayment and short-load behavioral tests are executed against the composed candidate where they read UI assets. Old release-shape assertions for the earlier ALLOC-only release are recorded separately; current source/receipt-specific resource, handler, syntax and single-token release checks replace those inapplicable release assertions. No test writes to production CMS.

The final package contains97 resources; only5 Purchase assets change. All92 others, app.js, shared task-signals, mutation planners, other departments, company separation, Stock List and financial/inventory backends remain exact. Only the Purchase Wix page version token changes. Deployment uses the isolated purchase-source-receipt-only scope, never the generic repository upload. Four release stages and user acceptance must be recorded separately; do not merge into main before the user's real-world confirmation.

Private evidence: C:/FMCG-WIX-LOCAL/handoff/purchase-source-receipt-display-20261031. Production data, screenshots and full live sources are not committed as public evidence.
