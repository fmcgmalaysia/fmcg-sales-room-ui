# Customer evidence, Finance posting and history — release acceptance

Status: runtime `28bcf9a` deployed; public acceptance partially complete. Branch `feat/customer-dispatch-history-20261101`, draft PR281, parent `07b882c`. Pages run324 (`41309021684`) succeeded;101/101 public assets match. Original7 deployment rules were restored. Both Master and FMCG Wix confirmed published/live after19 matched drafts. Customer file service is active Version11. No merge to main or new user-verified baseline. The previous f8aba73 package and live originals remain the recovery evidence.

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

Original801 Desk1 with100 Alloc/90 Loaded/10 residual is untouched. The old paid supplier PO and its two proofs remain intact. Loaded Records and account balance were publicly verified in Sales and Buyer; actual customer attachment delivery and Finance receipt confirmation remain pending.

SI60 initially returned504; one retry of the original request returned a generic error, while fresh Finance and Support reads proved the original invoice committed. No new request or second invoice was created. The candidate now checks an exact customer/Desk/request/invoice/line match after a failed response before showing success. This is tested UI recovery, not a claim that the underlying Wix transport error has been diagnosed or removed.

## Implemented in the released version

1. Customer-level Support payment proof/CN/DN, including pre-invoice customers; authoritative customer identity and currency. No fake order or Desk is required for customer-account evidence.
2. Unposted proof replacement preserves original files and history. Finance confirmation and replacement share the existing concurrency protections; a posted or superseded proof cannot be overwritten or confirmed again.
3. Finance uses one existing customer-account writer, same-request recovery and duplicate proof/file checks. The confirmed amount can differ from the Support reference; both facts survive. Legacy posted records retain their existing effects.
4. Customer delivery validates company/customer/document identity, confirms file-level sharing and retains the original ID. Explicit preparation of a legacy private file is recoverable; read requests never move/share files or create history.
5. Sales blue and Buyer green history interfaces show customer/currency statements and documents. No invented per-invoice payment matching. Late responses cannot cross customers/companies; expanded cards survive background reads. Nested attachments must match the prepared customer document library.
6. Money-entry formatting and exact-request SI recovery, without changing underlying price precision, stock or supplier locks.

## Confirmed business decision: Loaded Records

The existing deployed Warehouse page explicitly rejects old `FULFILMENT_READ_REQUEST` and `FULFILMENT_SAVE_REQUEST`: the old Dispatch entry is retired. The earlier plan to use that entry is invalid. A local-only reconnection was fully reverted; `master-shared/desk-delivery.js` has no candidate diff.

User selected: **Loaded plus SI automatically enters Loaded Records**. This supersedes the proposed Confirm Dispatched step. Do not add that action or reactivate the old Dispatch entry.

- One read-only eligibility projection validates issued invoices against the existing confirmed Loaded references. Existing historical Dispatch records remain immutable evidence; old unbacked invoiced-only records do not become Loaded by assumption.
- History and active quantities use this same projection.190 Loaded/invoiced cartons leave60 of250 active; the second60 becomes its own record after Loaded and SI. Unarranged demand and unresolved shortload remain visible.
- Customer accounts, supplier settlement and actual departure are separate facts. No new stock movement, Dispatch event, automatic payment posting or financial closure.
- UI says Loaded Records and Loaded CTN. Its date is explicitly SI issued/date, never an invented physical departure timestamp.

Fresh Wix customerCompletionProjection.js and source masterQuantityProjection.js match the repository before editing. Public shipment-batches.js also matches.111 affected checks pass, including9 new Loaded Records scenarios. One unrelated old Sales split fixture failed both the prior bee952c baseline and the candidate because it lacks valid preparation identity; the original output is retained, not counted as a pass.

## Verification and remaining work

- Customer-flow suite:162/162. History UI:8/8; these two runs cover170 distinct checks. Earlier overlapping totals are not additive.
- Protected consumer regression:323 cases,319 initially passed; four failed because the isolated Support test harness lacked the newly imported evidence reader. Bound the real reader without weakening assertions; all5 tests in that file then passed. The other318 passed in the original run. Original failure output is retained.
- Release package:101 resources,20 changed including2 new history files and version references;81 remain exact. Build `20261101-customer-loaded-records-v1`, isolated scope `customer-loaded-records-only`. The builder applies50 exact static hunks to the immutable99-resource `f8aba73` package. Four packaging checks pass, including syntax and protection of inherited customer-allocation.js and retired desk-delivery.js. Run324 deployed this package; all101 live resources match.
- Local Support/Sales/Buyer preview9019 and Finance preview9018 use fixtures. Simulated two payments of2100 are not live bank receipts.
- All17 existing Wix files were freshly compared and minimally patched;2 new read-only backend files were added. All19 complete drafts match candidates and both sites confirmed published/live. The file-service original matches07b882c; two isolated hunks were saved and read back. Normalized Code.gs SHA256: `bab53a40f29b82a773423b48acbfef4d38aaea576c357041969b9ce3a6a39b9a`. Active deployment is Version11, project `1pujJulysBJIhi361pZHBGQ5SeRCfDTO3W5Q61bn_XdcngqGPJENRSSUO`, deployment `AKfycbzjlAYtCCwqVg_tQXXuh34GTYQdknnjR2omKGj95wAUY12USDjJ5joAl98gI0Dr9sTU`.
- Pending: real customer PDF upload/open/forward; actual test-customer Finance receipt/CN/DN confirmation; ordinary customer-login access acceptance; user acceptance. No test PDF has been uploaded and no new customer receipt has been posted. Do not describe fixture receipts as live results.

## Public checks after release

All following reads used the actual new build in the in-app browser. Chrome's new iframe remained blank; the successful alternative does not diagnose or fix that Chrome behavior.

| Surface | Observed result | Evidence |
| --- | --- | --- |
| Sales history |190+60 CTN, SI3192+1008, balance USD4200; blue theme |SALES_LOADED_RECORDS_PUBLIC.txt |
| Buyer history |Same two records; green theme; admin assist context, not independent buyer login |BUYER_LOADED_RECORDS_PUBLIC.txt |
| Active remainder |Sales body and Buyer show9 active lines;100 committed, USD1680,1.4m³; fully loaded Extra Cheese removed |SALES_ACTIVE_REMAINDER_PUBLIC.txt; BUYER_ACTIVE_REMAINDER_PUBLIC.txt |
| Buyer statement |USD4200 invoices,0 payments,4200 balance |BUYER_STATEMENT_PUBLIC.txt |
| Sales legacy Documents & Payments entry |Opens the one read-only history Documents view; no upload action |SALES_DOCUMENT_ENTRY_PUBLIC.txt |
| Customer switch |802 shows no account records and does not retain801 history |SALES_802_ISOLATION_PUBLIC.txt |
| Support |Customer proof form starts reference amount0.00 and explains independent Finance posting; no upload submitted |STATUS.json |
| Finance AR |Two invoices,USD4200; explicit Finance-only actual amount notice |FINANCE_AR4200_PUBLIC_V1.txt |
| Stock |Warehouse and Finance820/780/40/0; FinanceMYR55658.40; GHR all0 |WAREHOUSE_STOCK_PUBLIC_V1.txt; FINANCE_STOCK_PUBLIC_V1.txt; FINANCE_GHR_ZERO_PUBLIC_V1.txt |
| Files |New NCT/GHR customer roots and old Sales roots remain owner-only,shared=false |CUSTOMER_DIRECTORY_AUDIT.json |

### Unfinished acceptance and discovered issues

1. File chooser: supported IAB/Chrome chooser event paths timed out before setFiles; native system chooser could not be safely controlled. The ChatGPT app permission prompt requires user action and was not self-approved. Do not change security settings, use injected file objects, fabricate upload success, or redeploy to address a tooling blocker. Synthetic PDFs are prepared under test-documents; no upload or Finance write occurred.
2. Complete the real two-payment chain only after a successful Support upload: each reference proof remains evidence only; Finance actual2100 produces4200→2100→0. Then verify CN/DN reference-versus-actual amounts, original-request replay and posted-proof lock. These scenarios have isolated coverage, not live acceptance.
3. Sales customer picker shows10 while its active body and Buyer show9. The body excludes Loaded+SI correctly. Badge source/count semantics need a narrow follow-up; do not call it resolved or change stock to match a display count.
4. Existing progress labels still include Shipped and bilingual slash tooltips. They must not be interpreted as actual departure proof. This release's history correctly says Loaded Records and SI issued; old progress wording remains a separate gap.
5. Old Sales split test fixture lacks preparation identity and fails on its prior baseline too. Keep the original failing evidence; it is not a passed test.

Evidence directory: `C:/FMCG-WIX-LOCAL/handoff/master-cross-department-stress-20261101`. Key files: STATUS.json, CUSTOMER_FLOW_TESTS.txt, PROTECTED_REGRESSION.txt, SUPPORT_READ_FIELDS_RECHECK.txt, FINANCE_AR4200_CONFIRMED.txt, FINANCE_STOCK55658_CONFIRMED.txt, GHR_STOCK_ZERO_CONFIRMED.txt, CUSTOMER_FOLDERS.json, CANDIDATE_PATCHES.json. Earlier PLAN and flow review sections that assume an available old Dispatch are superseded by this decision gate.

| Release stage | Current status |
| --- | --- |
| Code |28bcf9a synchronized; subsequent documentation commits do not change runtime |
| GitHub Pages |Run324 success;101/101 match; original7 deployment rules restored |
| Wix Studio |Master and FMCG published/live;19 matched drafts; file serviceVersion11 |
| Public verification |History, active remainder, AR and stock reads pass with stated limits; PDF delivery and actual Finance posting remain incomplete |
