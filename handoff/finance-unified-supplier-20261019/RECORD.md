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
