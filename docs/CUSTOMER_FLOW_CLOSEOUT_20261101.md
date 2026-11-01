# Customer evidence, Finance posting and history — candidate closeout

Status: local candidate, not deployed. Branch `feat/customer-dispatch-history-20261101`, parent `07b882c`; deployed static recovery package remains `f8aba73`. No production code, Apps Script version or deployment permissions changed during this candidate work. No merge to main or new user-verified baseline.

## Confirmed scope

- Support is the sole customer-document uploader. Sales can read, download and forward; new Sales document writes are denied. Recovery of an already committed legacy request is read-only.
- Support amounts are references. Finance alone records actual receipts, CN and DN using independent actual amount/date/currency and the same original PDF. Uploading a proof does not change the balance.
- New empty money inputs show `0.00`; valid edited amounts use two decimals. Preserve saved values, unknown values, drafts and original calculated unit-cost precision. Quantities and percentages are not money.
- Individual customer PDFs may have forwardable links. Company/customer folders remain private and physically separate from supplier and internal Finance material. NCT and GHR remain separate. One file ID, no routine second copy.
- HTTP/R2, POINTBASE, QD, stock movements, borrowing records, supplier payments and first-payment PO locks are outside this patch.

## Live pressure-test evidence

These are real test-customer operations, not fixture results. Do not repeat completed operations.

| Step | Confirmed result |
| --- | --- |
| 801 Extra Cheese demand250, PO250;802 PO300 | PO planned allocation retained;802 received300,801 initially180 |
| 801 short70 | Borrowed70 from802; no physical stock created |
| Support split | Desk2=200,Desk3=50; only authorized Desk2 initially visible to Warehouse |
| Desk2 Loaded190 | Short10 remained; Support moved10 to Desk3, resulting190+60 |
| SI190 | `NCT-INV-TEST-801-190-1101`, USD3192 |
| Desk3 Loaded60 and SI60 | `NCT-INV-TEST-801-60-1101`, USD1008; fresh Support read shows locked Desk3 |
| Late receipt70 and repayment70 |801 total received250, debt cleared; original repayment request `ca211709-1ca4-4f1f-9e6d-bb0c62ce661e` |
| Finance customer AR |Two invoices, USD4200; no customer receipt posted in this new live chain |
| NCT stock |820 on hand,780 reserved,40 free,0 isolated; Finance value MYR55658.40 |
| Extra Cheese stock |300 at MYR58.08, value17424.00 |
| GHR stock |All quantity totals0, valueMYR0.00 |

Original801 Desk1 with100 Alloc/90 Loaded/10 residual is untouched. The old paid supplier PO and its two proofs remain intact. Real customer attachment delivery, Finance receipt confirmation and dispatched-history acceptance are not yet performed.

SI60 initially returned504; one retry of the original request returned a generic error, while fresh Finance and Support reads proved the original invoice committed. No new request or second invoice was created. The candidate now checks an exact customer/Desk/request/invoice/line match after a failed response before showing success. This is tested UI recovery, not a claim that the underlying Wix transport error has been diagnosed or removed.

## Implemented locally

1. Customer-level Support payment proof/CN/DN, including pre-invoice customers; authoritative customer identity and currency. No fake order or Desk is required for customer-account evidence.
2. Unposted proof replacement preserves original files and history. Finance confirmation and replacement share the existing concurrency protections; a posted or superseded proof cannot be overwritten or confirmed again.
3. Finance uses one existing customer-account writer, same-request recovery and duplicate proof/file checks. The confirmed amount can differ from the Support reference; both facts survive. Legacy posted records retain their existing effects.
4. Customer delivery validates company/customer/document identity, confirms file-level sharing and retains the original ID. Explicit preparation of a legacy private file is recoverable; read requests never move/share files or create history.
5. Sales blue and Buyer green history interfaces show customer/currency statements and documents. No invented per-invoice payment matching. Late responses cannot cross customers/companies; expanded cards survive background reads. Nested attachments must match the prepared customer document library.
6. Money-entry formatting and exact-request SI recovery, without changing underlying price precision, stock or supplier locks.

## Blocking business decision: shipment history

The existing deployed Warehouse page explicitly rejects old `FULFILMENT_READ_REQUEST` and `FULFILMENT_SAVE_REQUEST`: the old Dispatch entry is retired. The earlier plan to use that entry is invalid. A local-only reconnection was fully reverted; `master-shared/desk-delivery.js` has no candidate diff.

Pending user choice:

- Recommended: add **Confirm Dispatched** within the current authorized Desk Delivery Task, after Loaded is complete and SI exists. Reuse the shipment ledger and do not deduct stock again.
- Alternative: Loaded plus SI may enter **Loaded records**, but must not be labelled physically dispatched.

Neither alternative is authorized by this document. Current history projection still distinguishes actual `DISPATCHED` from `INVOICED`. Acceptance H01/H02/S02 and the final live shipment chain are blocked until the user selects the rule. No old Dispatch UI is reactivated.

## Verification and remaining work

- Customer-flow suite:162/162. History UI:8/8; these two runs cover170 distinct checks. Earlier overlapping totals are not additive.
- Protected consumer regression:323 cases,319 initially passed; four failed because the isolated Support test harness lacked the newly imported evidence reader. Bound the real reader without weakening assertions; all5 tests in that file then passed. The other318 passed in the original run. Original failure output is retained.
- Candidate package:101 resources,11 existing resources changed and2 new history files, applied as exact hunks to the99-resource deployed `f8aba73` package. This is a preview package, not a release or final build marker.
- Local Support/Sales/Buyer preview9019 and Finance preview9018 use fixtures. Simulated two payments of2100 are not live bank receipts.
- Pending: Dispatch decision; final release regression/package; fresh Wix/App Script comparisons and minimal drafts; action-time permission confirmation where required; GitHub Pages/Wix publication; real customer PDF open/forward acceptance; actual test-customer Finance confirmation; user acceptance.

Evidence directory: `C:/FMCG-WIX-LOCAL/handoff/master-cross-department-stress-20261101`. Key files: STATUS.json, CUSTOMER_FLOW_TESTS.txt, PROTECTED_REGRESSION.txt, SUPPORT_READ_FIELDS_RECHECK.txt, FINANCE_AR4200_CONFIRMED.txt, FINANCE_STOCK55658_CONFIRMED.txt, GHR_STOCK_ZERO_CONFIRMED.txt, CUSTOMER_FOLDERS.json, CANDIDATE_PATCHES.json. Earlier PLAN and flow review sections that assume an available old Dispatch are superseded by this decision gate.

| Release stage | Current status |
| --- | --- |
| Code |Local candidate; dispatch boundary pending |
| GitHub Pages |Unchanged, previous f8aba73 runtime |
| Wix Studio |No new candidate synchronization or publication |
| Public verification |Existing live pressure-chain figures verified; candidate features not published or publicly accepted |
