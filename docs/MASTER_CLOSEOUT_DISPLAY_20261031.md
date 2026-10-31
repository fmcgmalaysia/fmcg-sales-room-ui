# MASTER source and payment display closeout

User request: finish the two outstanding display candidates before cost-management implementation. MST-01 and MST-04 remain independent commits, packaged together for one scoped release. Runtime stock, PO, allocation, loan, payment, reconciliation and Audit authorities are unchanged.

## Scope and recovery

The `master-closeout-display-only` composer starts with the publicly verified `0d6b492` composition and adds the existing MST-01 `dd60d43` and MST-04 `ced8531` display patches. Build `20261031-master-closeout-display-v1`:99 static assets; only Purchase task-info.js/app.js/index.html and Finance payment-layout.js/index.html differ. Warehouse, Support, Loaded handlers and all other94 assets are preserved exactly. No backend/private source is included in the static artifact.

Wix: add the new read-only allocationOriginInfo.js helper; append one import and one returned field in purchaseProjection.js; change one version reference in each Purchase and Finance page. No new CMS query or write, mutable origin ledger or competing stock rule. Full original purchaseProjection and both page codes were freshly copied; all matched the expected production originals before editing. All4 candidate drafts were read back exactly. Original helpers and page code are private in root handoff/master-urgent-closeout-20261031/.

Recovery: original purchaseProjection and the two page versions, plus the `warehouse-operational-header-only` static composer at0d6b492. The unused helper can remain inert during recovery; removing it is not necessary. Preserve independent receipt fixfc76b37 and journal97f9623, original801100/90/10 and all business records. Existing user-verified tags remain protected; no new user-verified tag or main merge is authorized by agent tests.

## Verified candidate behavior

- Mixed allocation80: Stock20 and Borrowed60. Returning20: Stock20 and Borrowed40, outstanding40. Repaying40: historical Borrowed40 retained, marked Repaid, outstanding0. Missing history: neutral Source80, never falsely Borrowed80. Browser Info uses the actual generated model and dialog, with synthetic data only.
- Purchase cash-paid request: Request Paid; credit-settled request: Request Settled. Partial/processing states remain unchanged. Finance unknown final payable: Payable pending review, amount and balance remain unknown; real0 remains0. Paid request does not auto-complete Audit or permit PO editing.
- The changed5 public assets and deployed manifest freshly matched0d6b492 before release preparation. See private CLOSEOUT_PREFLIGHT.json.
- Combined relevant regression:160 tests,159 pass,1 pre-existing assertion failure. It demands the Chinese WAIT label on Buyer, whereas production0d6b492 already renders Awaiting balance; both source pages and the test are unchanged. This was reproduced from the production revision and is not silently reworded for this patch.
- Additional protected payment/PO/privacy regression:29/29 pass. Release isolation:2/2 pass. Thus190/191 executed checks pass, with exactly the documented legacy wording mismatch and no new failure. Earlier79 origin checks and43 payment checks are retained as earlier evidence, not added again to these totals.
- Chrome candidate:4 Info scenarios, request-paid wording, Finance unknown payable and no captured application error verified. No business writes or financial transactions.

## Release stages

| Stage | Status |
| --- | --- |
| Code | Implemented, relevant regression and browser candidate verified; GitHub push recorded separately |
| GitHub Pages | Not deployed; exact one-run deployment permission required |
| Wix Studio |4 exact candidate drafts saved; not published |
| Public page | Pending after deployment; candidate preview is not public verification |
| User acceptance | Pending |

Remaining minor recovery/usability, attachment naming, validation feedback, Finance ETD and CMS measurement entries stay in MASTER_WORK_REGISTER.md. Cost authority migration remains unapproved and is excluded.
