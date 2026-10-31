# Purchase Active Orders clarity

User-requested presentation changes,2026-10-31 MYT. Recovery runtime7053e35/documentation358f218/build20261031-purchase-source-receipt-v1/PR257. Full fresh Wix Purchase original matches the repository, as do8 related public resources. Parent/repository rules, current handoff, ownership and design/efficiency framework were reviewed; unchanged detailed framework material is retained in the same conversation. Historical annotated verified/sales-buyer-design-20261014 keeps its narrow scope; this candidate is not user-verified. Preserve the separately deployed receipt backendfc76b37 and the two inherited LF-only changes. Main is unchanged.

## Approved display changes

- For genuine procurement above customer demand, Active Orders shows100|110 with a pale blue EXTRA tag and10 underneath. This is additional purchased quantity, not a claim of currently available physical stock. Ordinary allocations and the preceding170+30/470+30 source projection retain the original calculation; extras are not introduced into the allocation ledger.
- Since retains relative age and adds the true received date in dd-MM-yy, converted to Asia/Kuala_Lumpur. The user's02-08-26 is an example format, never a hardcoded date. Missing dates stay blank.
- Under an existing PO, show elapsed Malaysian calendar days from task receipt to the earliest successful PO-assignment event: Same day, In1Day, In2Days. Do not substitute elapsed time since the latest edit. Invalid/missing/reversed timestamps remain blank. Purchase Room retains the original timestamp presentation; this change targets Active Orders.
- Dashboard directories are no longer capped at145px. Small lists expand fully; long lists retain bounded internal scrolling, sticky headers, searching and the footer count. No data paging, sorting or query changes.
- A borrowed source whose matching loan responsibilities are all zero says Borrowed · Repaid 借入已补回. This historical source remains necessary to explain170+30=200; repaying does not rewrite which source was shipped. An outstanding loan keeps the existing borrowing label and read-only detail. The original PO200, supplier receipt200 and customer source170 are separate facts; the PO amount remains based on the original procurement200.

Only4of97static assets change: task-grid.js, task-grid.css, dashboard.css and Purchase index. Allocation handlers, source detail controls, stockCoverage, shared signals, all backends, other departments, Stock List, costs, amounts and financial locks remain unchanged. Wix changes one version token. No production data is written.

## RCV proposal discussed during this task

The user subsequently asked whether two Receive operations should appear as170+30. Recommendation: keep cumulative200 as the primary number and show170+30 beneath it, linked to the original receipt dates/quantities. This is a proposal, not implemented in this presentation release. Existing Purchase task projection contains the last receipt line and cumulative total; it does not send the full batch history. Full authoritative batches already exist in readWarehouseReceipts and Warehouse orders. Never invent two batches from beforeAccepted, combine borrowing with receipt history, or introduce a second receipt ledger. A future implementation should minimally expose/read the existing receipt history after fresh live-backend comparison; preservefc76b37 and existing company/department boundaries.

## Checks

Seven new checks pass for110/extra10 without changing physical coverage, ordinary/short/repaid source coverage, actual receipt date/timezone, earliest successful PO/day boundaries, unsettled versus repaid loans, JavaScript syntax and exact isolation of93unchanged assets.86existing behavioral regressions pass against the composed candidate. The one old settled-loan label expectation is updated only in the private test harness to match the approved Repaid wording; test inputs and all allocation/repayment expectations remain intact. Old release-shape assertions are not presented as current release gates.

Private originals, hashes, candidate preview and test outputs are in C:/FMCG-WIX-LOCAL/handoff/purchase-active-clarity-20261031. Four release stages and public evidence must be recorded separately. Keep the PR draft and do not merge main before user real-world acceptance.
