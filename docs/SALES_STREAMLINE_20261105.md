# Sales Room workflow simplification

Approved 5 November 2026. One task covers the user's ten Sales Room improvements, including replacing Repacking with Ready to Load. Buyer success/download behavior, customer identity, financial records and inventory writers are protected.

## Baseline and live comparison

Recovery is runtime `1b3aa789` and record `bd1a4e80`, with existing user-verified Selection Excel tags retained. Fresh Sales HTML exactly matched the checkout. Fresh Sales Wix page, onboarding.web.js, source masterQuantityProjection.js and MASTER purchaseQuantityProjection.js matched after line-ending/trailing-newline comparison. Public history JavaScript matched exactly; history CSS differs only in line endings and is not edited. Exact private originals and readbacks are in root `handoff/sales-streamline-20261105`.

## Ten acceptance points

1. Action Queue remains count-driven: RFQ/publication errors, incoming untransferred orders and user requests leave when their authoritative pending counts reach zero. Viewing never completes work. An empty queue collapses to one line.
2. Risk heading aligns with the other bilingual headings without an inline warning displacing its baseline.
3. The existing QD risk count appears with a rounded yellow warning on the QD launcher; zero stays hidden. No extra query or change to risk scope. Existing QD risk may include retained, no-longer-selected rows; that known scope is not silently changed.
4. Review reuses Catalogue product classification and numeric SORT ID, FOOD first, then SORT ID and stable brand/line tie breaks. Missing products are retained. It does not reorder stored order identities.
5. Optional PO hint is gray. Review date is DD/MM/YY text, with actual calendar validation and conversion to the existing ISO save contract. Revision guards, locks and retry identity remain.
6. Order Progress shows the customer's active orders together, without the Order ID filter or document/upload toolbar.
7. Five stages are Confirmed, Processing, Received, Ready to Load and Loaded. Requested and Committed quantity/value/CBM appear in two compact summary rows. Missing CBM stays unknown; different currencies never sum.
8. Order On displays relative day, DD-MM-YY and actor on separate lines.
9. Allocation replaces Message. It displays Desk quantities and a light-red Pending remainder, preserving repeated Desk batches and removing only Loaded+SI portions. Loaded without SI remains attached to its Desk. Sales chat and legacy document/shipment launchers are removed; the source web method rejects retired Sales chat/document operations. Other department chat systems and historical business records are preserved.
10. Transaction History precedes Buyer Activity. Sales has one invoice table with existing invoice/payment/file dialogs, while Buyer retains its tabs and account presentation. Existing history eligibility is unchanged: confirmed Loaded plus saved SI, or a valid charge invoice. Partial shipment leaves the unmet balance active; unpaid invoices retain Finance due amounts.

## One readiness authority

MASTER builds the existing packing context once and invokes the existing pure `changeDeskDelivery` validator as a read-only preview for the remaining authorized quantity. A failed validation produces no ready claim. This adds no CMS query, journal, stock movement, collection, invoice or photo. Only id/Desk/remaining/ready, a purchase-started boolean and validated loaded quantity cross the customer boundary. Source projection validates the fields and advertises whole-line readiness only when all outstanding demand is covered. An old packing timestamp or SHIPPED text cannot substitute for this result.

## Candidate validation and limits

- 73 focused and related business checks passed, including quantity, Desk, short/partial loading, history, customer isolation, demand adjustment, frozen packaging and dates.
- 101 existing Buyer checks: 100 passed; one historical package assertion depends on current Sales sources and is superseded by this scope's frozen manifest. Buyer HTML and its download handlers are byte-preserved in the new package.
- Earlier Sales UI run contained six failures reproduced against baseline and twelve expectations/fixtures affected by the approved retirement, five-stage and date-input changes. These are tracked rather than described as new business failures; new behavior has dedicated scenario tests and actual Chrome candidate checks.
- Actual isolated Chrome candidate: initialization without errors; five-stage/Desk/Pending render; FOOD/SORT ordering; impossible date rejected; valid DD/MM/YY saved through the unchanged ISO contract and read back. No production orders, payments, receipt, Loaded or files were created.
- Production preview still requires four-stage release verification. No claim of fixing intermittent Wix blank frames or Buyer downloads.

## Release package

`sales-streamline-only`, build `20261105-sales-streamline-v1`: 96 runtime resources. Index and shared history JS change; five Sales-only retired resources are removed; 94 other assets remain byte-identical, including Buyer HTML. Four Wix sources have minimal isolated replacements and full readbacks. No changes to server permissions or sharing rules are part of the business patch.

Code: candidate. Pages: pending. Wix: four exact saved drafts, not published. Public verification: pending. Main is not merged.

Review sorting batches this order's string/numeric barcodes in groups of 100, then passes the product results to the same classification/sort projection used by Order Progress. This avoids treating a selection-item ID as a product ID and issuing serial per-item fallbacks. The default existing progress call remains unchanged. API reference checked: https://dev.wix.com/docs/sdk/business-solutions/data/items/wix-data-query/has-some .
