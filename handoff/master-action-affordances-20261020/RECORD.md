# MASTER action affordances — 2026-10-20

## Approved scope and current boundary

User approved finishing Purchase split-row operability and the existing Sales message release, plus quantity typography, passive pale states, blue semibold clickable PO numbers, blank missing values, Follow-up-only payment amendment and Warehouse camera icon. Ready Stock definition is discussion-only after earlier work. On the separate split-mother checkbox question, user required deeper scenario analysis, not acceptance of the suggested selection semantics. No split sorting/checkbox implementation is included here and no backend changed.

Branch style/master-action-affordances-20261020 starts at36bfb35; recovery verified/sales-requested-split-20261020 remains e93006c. Before edits, eight public resources independently matched current Git: Purchase app/grid/index, Warehouse workroom/index, shared theme, Account and Support indexes. Existing verified quantity/PO/payment/receipt rules remain protected. New shared CSS is narrowly selector-scoped; inclusion across four rooms is not proof every old component has already adopted the global design rule.

## Candidate changes

- Existing quantity values/calculations unchanged; Order/Rcv inherit the same font/weight. Passive orange mismatch becomes pale orange/dark text; passive blue GP and receipt become pale blue/dark text. Existing high-risk red retained. Known clickable PO number components use #2563EB/600. Genuine action buttons are not globally inverted.
- Purchase grid strips only standalone rendered em-dash text nodes; true0, business values, error strings and calculations remain. No generic DOM observer or financial-data mutation.
- Submitted Payment Request always opens a read-only summary. Footer hidden, no Edit Request action; bilingual directions to Follow-up. Initial unsubmitted request submission remains accessible.
- Follow-up grey status is a span, not a button. Editable appears only when existing backend eligibility permits it and only opens the existing amendment form from the payments view. Frontend predicate now rejects any existing Account review, aligning to paymentHandoff.js line51, not merely review.stage===REVIEWING. Backend authority, versions, ownership/return and financial writes unchanged.
- Only unprepared Warehouse Packing button box changes to the existing camera SVG; prepared thumbs-up, status box, packing/photo/save actions unchanged.

## Verification and preview

31 focused tests passed after intended blank-display expectations were updated. First new test extractor accidentally included the following async function/listener; fixed the test boundary, not production. Existing two tests expected visible em dashes; changed only those display assertions, preserving no-invented-cost/GP checks. A final predicate/PO CSS specificity change reran only eleven affected tests and local browser QA: all pass.

Actual Purchase/Warehouse local browser check passed: computed pale GP colours, matching quantity fonts, blank missing amounts, Follow-up-only edit, submitted readonly dialog without footer, camera SVG; no page errors. Synthetic fixture initially lacked documentStatus and caused an undefined.toLowerCase error; fixed only the fixture. No Wix/CMS/Drive messages or business writes. Local8953 preview reads actual frontend files with synthetic transport and no production Save; existing Chrome candidate51426679 updated to /handoff/master-action-affordances-20261020/preview.html after confirming no open draft. Screenshots candidate-quantities.png/candidate-readonly-payment.png/candidate-camera.png. Further shared-consumer/mobile/final regression required before release.

## Release status

Code: candidate only. Pages: NOT deployed for these affordances. Wix: NOT synchronized for these changes. Public UI: NOT verified for these changes. No temporary Pages permissions added. Existing Sales messaging deployment ba45952 and its separate release receipts must not be confused with this candidate. Do not claim all requested work or global palette implementation complete. No main merge.
