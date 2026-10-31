# Company Stock List

Scope: read-only Warehouse and Finance Stock List, with one existing quantity authority. No stock writes, automatic allocation, Desk assignment, payment changes or new ledger.

NCT and GHR use physically separate CMS collections. NCT uses NCTOrders, NCTTasks, NCTActivity; GHR retains its existing NCTOrders1, NCTTasks1, NCTActivity1 names. Do not merge them or substitute a company filter on shared stock collections. Purchase allocation, Warehouse and Finance read the respective company's existing records. No cross-company borrowing or stock transfer is introduced.

Recovery: published Ready Stock runtime 3401d75, documentation base 4c2f26e. Fresh full Wix originals of Warehouse, Account, stockControlService, stockControl.web, purchaseProjection, customerFulfilmentService and stockCardProjection match the checkout after newline normalization. Eight affected public baseline assets match the inherited release plan byte for byte. Private evidence is under handoff/stock-list-implementation-20261031 outside this checkout. The separately deployed receipt backend fc76b37 is preserved; do not replace it from this checkout. Existing historical verified tags retain their original scope. This candidate is not a user-verified baseline.

Warehouse retains a server-side whitelist with quantities and source identity only. Finance has a separate authorized read method using the existing Account staff guard and the same quantity projection. The client cannot request finance enrichment from the Warehouse endpoint. Neither endpoint writes records or browsing history.

Finance value is remaining physical quantity multiplied by each confirmed source's net purchase cost, including fully received FOC dilution. It is not paid amount, selling price or POINTBASE reference price. Freight, tax, subsequent credits and write-downs are excluded and the page states this boundary. Source amounts round to cents before summation; the weighted average uses remaining source quantities. Partial FOC receipts lack paid/free composition and remain cost-unconfirmed. Missing or inconsistent costs are not zero; known-value totals explicitly flag omitted quantities. Isolated goods remain physical stock at their source purchase value until recorded disposition changes physical stock. This is a purchase-cost view, not a claim of complete statutory inventory valuation.

Only recorded receipt sources are included. Unrecorded opening stock still requires reconciliation. Unknown physical quantities remain unknown. Summaries cover the full filtered list, not just one page. Allocation, borrowing and repayment change ownership; only the existing physical-outflow authority changes outbound quantities. No duplicate deduction is added.

UX: compact read-only summaries and source detail; no Save. Reads are coalesced, old results retained on failure, late replies ignored after company switches, and reading status occupies fixed height. Finance UI is English; Warehouse retains bilingual labels. Stock List is mounted after existing Finance renderers are deactivated, preventing a delayed finance response from replacing the pane.

Validation: 14 new backend/UI checks and 85 affected regressions passed. Includes actual Loaded with duplicate receipt and subsequent invoice, authorization, disjoint collections, mixed known/unknown costs, partial FOC, source attribution, isolation, pagination/cost revisions, stale-company replies, read coalescing, protected short-load and Ready Stock workflows. Browser verification uses explicitly synthetic data and no CMS writes. Final candidate/resource and public verification remain to be recorded.

Release composition: 97 assets, 9 changed or added; all other inherited assets remain byte-identical. Scoped workflow company-stock-list-only includes no backend sources or private evidence in Pages. Wix changes: stockControlService isolated projection additions; two new finance read modules; Account read relay and version; Warehouse version only.

Current release stages: code candidate; GitHub Pages not deployed; Wix draft installation not completed; public verification not completed. Do not merge into main until user acceptance.
