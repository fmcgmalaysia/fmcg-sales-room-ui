# Unified Finance supplier work page

Scope authorized by the user: combine Payment Plan and Supplier Accounts, remove the independent planning dialog and redundant Status column, retain strict Finance Job Done gates, and display upload time plus employee in PO/PI/DO/INV/CN file dialogs.

Framework reviewed: root AGENTS.md and START_HERE.md, Finance payment-plan and supplier-closeout records, MASTER standard and existing Finance readers, writers and settlement projection. Recovery is parent b33c0ae. Existing verified tags remain limited to their recorded workflows; this candidate is not a user-verified production baseline.

Fresh live Account entry and accountSettlement sources matched repository exactly after line-ending normalization. All six affected frontend assets were captured and matched before their final patches. The CSS patch was restored, its fresh live comparison completed, and then reapplied. Private exact source captures, hashes, test outputs and screenshots are under the root handoff directory of this name.

Public read-only Finance inspection confirmed NCT-PO-888888 receiving is 95 of 100 with an unresolved receiving issue. No receiving backend repair is needed. No production business records were changed during candidate acceptance.

Supplier Accounts now contains Open, Payment Required and Closed filters. Payment Required uses the existing request membership calculation. Final payable, net paid, balance and request due remain distinct. Legacy payments navigation resolves to the unified page. Existing stored planning data and backend compatibility are preserved, while the independent planning form is inaccessible.

The unified list removes Status. Genuine payment uncertainty/processing and closed-review alerts remain adjacent to Action. Job Done still opens the existing confirmation and depends on server eligibility. Blocked rows retain Review & Resolve. No backend production module, authentication, payment journal, upload storage, file URL or download mechanism changed.

Every document-type file popup now displays existing uploadedAt and uploadedBy fields, with escaped employee text and unchanged View/Download/Report Issue controls. Candidate Chrome verification confirmed the rendered timestamp and employee.

Validation: 65 focused Finance tests pass. Direct backend tests independently reject closure when Final INV, amount verification, CN decision or resolved receiving is missing. Existing settled-payment/proof and customer-invoice independence tests remain passing. Full suite: 648 of 652 pass; four previously recorded baseline failures remain in customer-short-names, installment workflow expectation, staff-name suffix expectation and quantity-feedback language. Syntax checks and diff whitespace checks pass.

Synthetic Chrome acceptance: 95 of 100 blocks Job Done; complete supplier evidence allows confirmation into Closed; reasoned Reopen returns Open; Payment Required shows outstanding request separately; upload metadata appears in the INV popup. These synthetic operations do not write production records. Real positive financial closure remains pending actual business acceptance.

Candidate marker: 2026-10-19-finance-unified-v1. Wix pointer token: 20261019-finance-unified-v1. At this record, code is candidate only; Pages deployment, Wix synchronization/publication and public acceptance are pending. Main is untouched. The new branch requires separate temporary Pages allowlist authorization before deployment and restoration of the original seven rules afterwards.

## 2026-10-19 professional Finance read separation

User approved separating operational supplier cases, financial transactions and the immutable audit trail. Recovery remains the published baseline `8da03d86e931748b8394d4d6202ecaf045e96ba2`; no production business record was changed.

Commits `46d6b46` and `cdc2d66` add a bounded read-only query contract and switch Supplier Accounts, Transaction History and Audit Trail to server-filtered cursor pages. Supplier Accounts uses `Active` and `Completed Audits`; Transaction History returns one payment per row; Audit Trail returns one action per row. Search, supplier and date range travel to the server. Page size is 50 with a server maximum of 100. Dashboard task, supplier, total amount and partially paid metrics come from the full filtered result rather than the current page. Existing Account saves, settlement actions, file handling, credit application and legacy full reader remain intact for recovery and comparison.

The candidate marker is `2026-10-19-finance-account-query-v1`; intended Wix token is `20261019-finance-account-query-v1`. The local Chrome sample confirms the renamed navigation, completed-audit tab, independent transaction row, filters and `Previous / Next` controls. Focused Finance regression is green. Full suite remains 663/667 with the same four previously recorded baseline failures: customer-short-name fixture dependency, installment status expectation, retired staff suffix expectation and old bilingual quantity-feedback expectation.

Important scalability boundary: the browser no longer receives all Finance history, but the server query currently obtains the existing complete Purchase projection before filtering. It is not yet the final million-record backend. The next phase must add a derived, indexed, read-only Finance projection with deterministic reconciliation against the existing authorities. Do not create or backfill that production collection, and do not remove the legacy reader, until index schema review and old-versus-new result comparison are complete.

This query candidate has not been deployed to GitHub Pages, synchronized to Wix, published, or verified on the public page. The existing formal Wix Account page still points to `20261019-finance-unified-v1`.

## 2026-10-19 guarded derived-index staging

The production Wix CMS collection `AccountReadIndex` was created as an empty multiple-item collection. No business authority collection was changed and no derived record has been written yet. Wix Data remains schemaless, so missing CMS display fields do not prevent the guarded backend from storing the reviewed records; collection permission changes remain deliberately untouched.

Before synchronization, the formal live `accountPurchase.web.js` matched published recovery `8da03d86e931748b8394d4d6202ecaf045e96ba2` after line-ending normalization, hash `d2eea1cff77d105867f512cdc898203264aa1543a3005e9dd71c6e91155e2c78`. The staged Wix editor now contains exact candidate copies of `accountReadIndex.js` (normalized hash `c85ee38a3df1d9b7da30254f84d7af79fce7acfebf9a1d4320a90cc38c10e590`) and `accountPurchase.web.js` (normalized hash `39c26f0b92344e702e03eab86bf86364d6e78970fc6269bb54aaf6f1ede8117c`). Wix autosave is on and latest build `9dcdd5b6-f79b-4b5c-a138-a93e26034b90` reports Success at 2026-10-19 12:44:40. The site has not been published after these editor changes.

The derived index is immutable by generation and contains separate CASE, TRANSACTION and AUDIT records. It excludes staff-specific file-deletion permission decorations, rejects any item above the reviewed safe size, stages in batches of 500, rereads authority before activation, refuses changed authority or any missing/extra/changed record, and activates only by one control-record update. Old generations are retained. Existing writers and the existing reader remain unchanged and authoritative; there is still no query cutover.

A temporary allowlisted maintenance route is prepared locally for a SUPER ADMIN to run PLAN, STAGE and later ACTIVATE from an explicit Finance URL. Ordinary Finance loads do not enter it. PLAN is read-only; STAGE writes only an inactive generation; ACTIVATE requires a 32-character reviewed generation and the backend re-verifies authority and exact content before changing the control record. Finance regression is 93/93. Full suite is 673/677 with the same four recorded baseline failures. This maintenance route is not yet committed, deployed to Pages, synchronized to the Wix page, published or run against production. Dry-run counts, generation and comparison are therefore still pending.
