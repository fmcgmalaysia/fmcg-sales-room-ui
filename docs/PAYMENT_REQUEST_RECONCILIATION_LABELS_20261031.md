# Payment request and supplier reconciliation wording

MST-04 is a display-only candidate. A completed payment request is not final supplier-account reconciliation. Purchase already has a request-basis footer; this patch makes its completed row label equally explicit.

- Cash-settled request: `Request Paid`.
- Request settled partly or wholly by credit: `Request Settled`.
- Finance Supplier Accounts with unknown final payable: `Payable pending review`, preserving the unknown amount and balance as dashes.
- Known zero remains zero. Existing partial/processing states, colors, payment amounts, first-payment PO lock and Audit completion conditions do not change.

The fresh public generated assets exactly matched the previous release composition before editing: Purchase app SHA256 `f43bf5899b900f3b9ee5f464ae05f808585a460c3ec80ada486c0e9db8254fba`; Finance payment layout SHA256 `e0f5d85dda42073b285a76fce4b962e08673fa8a87e9cbb15f369f5bd52f3452`. Recovery is the prior generated asset pair, not the old raw source files.

The candidate generator changes exactly two label expressions and their two HTML version references. It composes the separate MST-01 candidate and is not the pending Warehouse release. No workflow deployment scope or Wix draft has been added for this candidate.

Validation: 6 new cases and 37 existing payment-plan, payment-handoff and supplier-closeout cases pass (43 total). Cases cover cash versus credit, unknown versus genuine zero, partial/processing states, no automatic Audit completion and preservation of existing completed audits. No real financial or CMS records were written.

Code: tested background candidate. Pages: not deployed. Wix: not synchronized or published. Public: not verified. Broader shared-consumer regression and browser acceptance remain required before release. Do not mark complete or merge main before the required acceptance.
