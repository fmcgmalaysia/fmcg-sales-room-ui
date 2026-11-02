# Compact Purchase tasks

Scope: the user requested more task space, removal of Pending P.O./Incoming Alert cards and the lower customer/supplier filters, a compact customer picker with pending/issue counts, and an independent Stock Actions entry.

## Evidence and recovery

- Published recovery package: `bcfe855`, 101 assets. This patch uses the exact versioned package, not the checkout's older raw entry files.
- Fresh public app, index, active-orders CSS, active-layout, dashboard and task-info all matched that package byte for byte.
- Fresh Wix Purchase page exactly matched `integration/wix/purchase-room-page.js`; normalized SHA256 `d1b99fbf313c49a3c3e2a99be1897d62499167177bb61c0bca793c42d3d49bef`.
- Existing annotated design checkpoint remains `verified/department-ui-before-20261018`. No new user-verified tag is claimed for this candidate.

## Result

One compact row contains **Purchase Tasks 采购任务**, a customer picker, two same-height counts and Move rows. It replaces the large cards, company subtitle (company remains in the MASTER header), work-source tabs and lower filter strip. Original task columns, renderer, fixed table header and task scrolling remain intact.

Stock Actions is a top-navigation entry to the existing `stock` view. Borrow repayment, borrowed-stock return and allocation reconciliation use exactly the same shipped module and write handlers. New allocation continues through customer-task ALLOC. No new page backend, collection, journal or stock authority is introduced.

Customer counts reuse the existing Dashboard classification. Source rows are deduplicated to the customer task; red takes precedence if the same task also has pending work. Orange includes unresolved work waiting on another department. A completed receipt awaiting ordinary Finance review stays orange; explicit financial risk retains the existing red classification. Unknown PO context shows a dash rather than false zero. NCT and GHR count only the workspace supplied for the selected company.

The customer selector remains open, with its focus, during background render. Selecting a customer closes it. Escape and outside clicks close it. No extra data request or CMS write was added.

User follow-ups in the same unpublished candidate: orange Alloc Qty capsules no longer show redundant Info; the original quantity and allocation triangle remain. Blue allocation discrepancies, unknown source details, receipt batches and the original read-only detail dialog are preserved. Ordinary supplier/stock child rows are white; selection and drag feedback keep their existing highlight.

## Validation

- 10 candidate-specific scenarios pass, including deduplication, receipt-review severity, PO-level mapping, unknown state, exact resource isolation and orange/blue/unknown Info behavior.
- 25 existing Dashboard/personal-row-order checks pass.
- The old Stock Actions launcher failed before running its cases because it rebuilds a 29-Oct frozen Support resource against newer code. The expected/actual hashes and failure are retained in the private handoff; none of those historical files were changed here.
- All 10 existing Stock Actions behavior scenarios were rerun against this exact candidate instead, and pass without skips. They cover borrow, repay, return, reconciliation, pending-save guards, unknown quantities and company isolation.
- Browser candidate: All Customers 45 rows, ABC 30, XYZ 15; ABC pending2/issues1; GHR empty with zero counts; Stock Actions opens its existing empty state; no captured application errors. These are synthetic fixtures, not new production orders.
- Task scrolling was observed at 491.2px while the column header remained at the task container's top. The customer menu remained open across the background-refresh interval. Follow-up DOM verification confirmed ordinary supplier and stock children use rgb(255,255,255), selected children retain rgb(255,240,214), and the orange allocation fixture has no Info link.

## Release boundary

Candidate build `20261102-purchase-compact-tasks-v1`, scope `purchase-compact-tasks-only`. Exactly five Purchase display resources change; the other 96 of 101 assets are byte identical. Only the existing Purchase Wix version token changes. Backend, inventory, PO, payment, GP formulas and save receipts are unchanged.

Wix single-token draft read-back exactly matches the candidate (normalized SHA256 6c6169d8ef411652189bb55824902d8262b5ade8076c454d6f1f565e19ef9fe6); it has not been published.

Code, GitHub, Pages, Wix and public acceptance must be reported separately. Do not claim this candidate is published from local checks. MASTER Sales Management, the GP repeated-event issue and real customer PDF/payment acceptance remain independent open work; this layout task does not resolve them.
