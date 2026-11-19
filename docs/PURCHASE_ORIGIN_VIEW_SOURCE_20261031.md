# Purchase origin consumers

Continuation of MST-01, same read-only source-display objective. The user authorized completing the remaining work. Public verification ofca5ed1b exposed two missed consumers: app omitted allocationOrigins from the grid arguments, and the grid omitted it again from Info context. A settled task hides its ALLOC Info, leaving the old source box as the usual entry. That box and its child-row label still treated a mixed60 as wholly borrowed.

Fresh public evidence: TESTING01 late AJAX has own170 plus external source60 from NCT-PO-STRESS-B2-1031. Existing saved history is free20 plus borrowed60, return20, then repay40. The old child says Borrowed/Repaid60 and its box shows total60/outstanding0 without the20/40 split. This is not a stock change or a new loan. The previous patch corrected the isolated model but its initial tests bypassed the real grid context; they were insufficient. MST-01 remains incomplete until this consumer patch passes publicly.

## Minimum correction

- app forwards allocationOrigins to the existing grid call; grid forwards it to the existing Info context.
- The stock child uses that same Info model, with a source-total consistency guard. A known Stock20+Borrowed40 displays one Mixed Stock60 row. Pure borrowed40 retains its prior label; a full return leaving free20 becomes Ready Stock20; uncertain evidence uses neutral Stock source.
- Existing View source appends the same model's source quantities to its read-only details. Original supplier, PO, receipt time, allocation time, operator and outstanding debt remain available. No alternative provenance calculator, stock balance or CMS store is introduced.

Branch `fix/purchase-origin-view-source-20261031`, scope `purchase-origin-view-source-only`, build `20261031-purchase-origin-view-source-v1`.99 static assets, only4 Purchase files change: app.js, task-grid.js, customer-allocation.js and index.html. Other95 assets, all backend modules, Finance, Warehouse, Support, allocation save handlers and Loaded writers remain exact. Wix changes only the Purchase page version reference.

## Validation and recovery

10 actual consumer/integration checks plus77 related allocation, borrowing, repayment, batch binding, shortload and Desk checks pass:87/87. The regression reproduces the lost context in the deployed composition before applying the fix. Normal/no-stock/partial rows remain byte-identical; existing allocation mutation handlers are byte-identical; no saves occur in source-box tests.

Chrome candidate uses the generated task grid and existing View source handler, covering mixed outstanding80=20+60, returned/repaid60=20+40/outstanding0, pure borrowed40, full return leaving Stock20, and unknown evidence. No captured application errors. The actual formal Purchase page was copied in full and matchedca5ed1b before changing its one version token; the candidate draft readback is exact.

Recovery is theca5ed1b static composer and its Purchase page version. Preserve the deployed read-only helper and both existing background repairsfc76b37/97f9623. No protected production baseline or main merge is created by these tests.

Code/tests/candidate complete; GitHub push, the new branch's one-run permission, Pages deploy, Wix publish, public verification and user acceptance are recorded separately. Theca5ed1b permission was consumed and removed; it cannot authorize this release.

## Release acceptance — 2026-10-31

| Stage | Observed result |
| --- | --- |
| Code | `b86805aaa1ad69f3295eaac2bd8b0d68b897c360`, PR272;87/87 checks passed. |
| GitHub Pages | Single approved run [41213120105](https://github.com/fmcgmalaysia/fmcg-sales-room-ui/actions/runs/41213120105), job124572060509 succeeded; only the scoped prepare/upload ran.99 normalized assets and all99 manifest hashes match;95 byte-exact,4 line-ending-only differences. |
| Permission | Exact action-time approval used once. Temporary branch rule removed immediately after workflow success; original7 branches and0 tags verified. |
| Wix Studio | Purchase one-token version draft fully read back and exact. One Publish action returned published/live. No new backend draft changes. |
| Public | Clean native Chrome Purchase page loads `20261031-purchase-origin-view-source-v1`, LAW/NCT; actual mixed and pure-source cases below passed, no captured application error. |
| User acceptance | Pending; no main merge or new user-verified baseline. |

Public TESTING01 late AJAX retains one Mixed Stock60 child. Its original View source now shows source PO NCT-PO-STRESS-B2-1031, Stock20, Borrowed/Repaid40 and outstanding0, retaining original supplier/receiving/allocation/operator details. The original earlier AJAX pure-loan child remains Borrowed/Repaid30; the box shows30 and outstanding0. TESTING801 LAY'S remains Alloc100/Loaded90. No synthetic scenario was written to production for this release.

Payment regression: the latest Purchase page still shows Request Paid12500/4files, Request Paid5808/2files and Partially Paid123000/balance456, with no paid Editable entry. Finance Stock List retains NCT270/reserved230/free40/isolated0/MYR19814.40; prior GHR0 isolation evidence is preserved. All verification was read-only; no stock, PO, loan, repayment, payment or Loaded write.

Evidence: root handoff/master-urgent-closeout-20261031/ORIGIN_CONSUMER_PUBLIC_ASSETS.json, origin-consumer-permissions-restored.png, origin-consumer-wix-published.png, origin-consumer-mixed-public.png/txt, origin-consumer-pure-public.txt, origin-consumer-801-public.txt, origin-consumer-payment-public.txt and final stock evidence. The first isolated-model omission is retained in the record, not erased from history.

Private evidence remains root handoff/master-urgent-closeout-20261031/, including origin-consumer-tests.txt, origin-consumer-regression.txt, origin-consumer-mixed-candidate.png, origin-consumer-purchase-before.js/draft.js and the earlier public source-entry-gap evidence. Other work-register items and the proposed cost migration are excluded.
