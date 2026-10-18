# Finance payment-request and supplier-account views

User approved the distinction: Payment Plan handles Purchase payment requests; fulfillment of the current request removes it from that list even when the PO still has receiving or document issues. Supplier Accounts retains whole-PO supervision.

Framework read: root AGENTS and START_HERE, latest Account readability acceptance, MASTER workroom standard, paymentHandoff request snapshots, accountSettlement reconciliation and archive projection, purchaseOrderWorkflow, Account layout/controller/settlement writer and affected tests. Historical records were not treated as new deployment evidence.

Recovery: runtime 72bd333311d4d8be7a41c47ad0f7d8c5ddc6772b, acceptance record 2b4f165, PR179; exact prior Wix snapshots and public evidence remain in the private account-note-readability handoff. Existing annotated verified/purchase-row-drag-save-20261016 is a limited protected workflow checkpoint, not a claim of full Finance transaction acceptance. Fresh six public frontend assets matched before edits. Fresh complete Wix Account entry matched normalized FNV1a 1986488109 /3426 chars and SHA256 771654AA3A586250001A7BADC62276096370FF7073B26CDB1EF5B839E50C99DC; exact copy stored privately.

One objective: separate current request execution from ongoing whole-PO supervision. Account frontend only, plus a version pointer. No backend, financial writer, permissions, saved request, file delivery, ownership/return, company identity or archive rules changed. Main remains untouched.

Payment Plan now filters current Purchase submissions by their remaining request balance. Historical/unsubmitted/returned/withdrawn and Finance-adopted legacy POs are available in Supplier Accounts. Unknown monetary basis stays visible; unresolved PROCESSING/UNKNOWN bank operations stay visible and retain existing locks. Request amounts use the existing server snapshot; confirmed refunds after submission are added back only for the request-execution view, preventing an already fulfilled instruction from turning into another payment demand. No cash ledger or stored amount is changed. Refunds before a new submission are not counted again; transferred credit is deducted once. Missing/unknown values remain unknown.

Supplier Accounts Open retains all non-HISTORY POs, including prepayments and checked orders still blocked by missing customer invoices; Closed uses only the existing backend HISTORY state. It shows whole-PO final payable/net paid/balance, actual receiving quantities and risk, Docs/Pay Slip/Note from Purchase/bank, plus the original files/reconciliation dialog. Request and whole-PO amounts cannot be confused by a paid deposit. Account header displays Finance Department; internal identifiers and other department headers remain unchanged. Cash and loan balances remain Not set.

Chrome: task preview updated from the standalone concept to the actual candidate frontend with an isolated sample-only message parent. Paid-deposit removal, continuing Supplier Accounts visibility, shortage red status and original reconciliation/file controls exercised. No real payment, reminder, file upload/deletion or procurement operation was submitted.

Validation: 14 new controller/renderer scenario checks pass. Focused payment/recipient/chase tests pass. Full baseline family retains the same three previously documented failures (Master names fixture binding, legacy instalment status expectation, Sales/Buyer feedback language). Final totals recorded privately. Search and Open/Closed state do not leak to Overview. Existing settlement/download/ownership regression tests remain intact.

Not included: independent JOB DONE action, changes to backend auto-HISTORY or customer Sales Invoice gate, new interdepartment issue workflow, supplier-credit closure policy and intermediate-width navigation repair. These remain explicit follow-up scope, not implied by a view rename.

Release status: code candidate; GitHub/Pages/Wix/public release status to be recorded after actual receipts. Local preview is not publication evidence.
