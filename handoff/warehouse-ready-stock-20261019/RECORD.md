# Warehouse Ready Stock — 2026-10-19

Objective: show usable received stock on Delivery Tasks. User confirmed Delivery Tasks should show products with usable receipts rather than all customer demand. Preserve already prepared, loaded, dispatched or stale work for review.

Fault evidence: formal Incoming P.O. shows 100 planned / 95 accepted; Delivery has all seven customer lines and every Ready Stock cell is a hard-coded dash. Both warehousePreparation.js readyStock=null and workroom.js placeholder were still disconnected. Fresh Wix preparation/web/page source and public index/workroom matched parent before edits. Recovery: 8ba5181; prior Warehouse runtime47bf37d; verified/department-ui-before-20261018; exact live source snapshots retained privately in C:/FMCG-WIX-LOCAL/handoff/warehouse-ready-stock-20261019/.

Patch: readonly stock projection uses physical available stock from existing receipt/stock projection, joins supplier children, excludes quarantined/dispatched stock and outstanding allocations to other customer tasks; includes explicitly allocated external receipts without counting them twice. Cap at remaining customer demand. No receipt, allocation, stock, procurement, invoice, finance, packing, loading or dispatch writes changed. Existing allocation requirement for packing is retained. The UI displays readyStock and applies one shared visible-task filter to cards, table and customer picker. API task identity/data remain available for existing handlers and history. Missing-CBM capture and S-only delivery chat are retained.

Validation: 28 focused Warehouse checks pass. Broader affected suite: 57/58 pass; one old Chinese-copy assertion fails identically on unchanged parent module (Account English-only rendering). Candidate Chrome shows Pending Packing1 / Delivery1 / Ready Stock95 / Task Qty100; Incoming100|95 and red shortage retained. No live business record changed.

Wix isolated preparation and page pointer drafts read back exactly. Initial semantic editor selection returned to the page model; unique-match guard stopped further edit. Page readback remained candidate-exact, preparation remained original-exact; then native current-editor replacements applied and full preparation readback matched candidate. No abnormal draft published.

Release pending: GitHub Pages, Wix publish receipt, real Warehouse refresh and 95-carton acceptance. No main merge or user-verified baseline claim.
