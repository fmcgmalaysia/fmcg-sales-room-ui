# Warehouse missing CBM capture

Scope: only Warehouse Delivery Tasks missing CBM. Red CBM capsule beside barcode opens a compact dialog. User chose direct POINTBASE reads through the unchanged CATCH COST transport; no SYNC-result endpoint, automatic refresh, cost recapture, or existing-CBM replacement.

Recovery: 3427084 (runtime 638e9c4), verified/department-ui-before-20261018. Fresh Warehouse page, warehouseReceiving.web.js, warehousePreparation.js, purchaseProjection.js and pointbaseCostClient.js read from Wix; normalized source matches baseline. Public Warehouse HTML/CSS/workroom matched baseline. Exact private source copies in root handoff/warehouse-missing-cbm-20261018.

Storage: one immutable WAREHOUSE_CBM_CAPTURED activity event per company/customer-demand task. Existing positive order CBM takes precedence. Warehouse projection reads the supplemental value; orders, tasks, costs, invoice snapshots, receipt/packing/loading versions and other departments remain unchanged. This release does not propagate supplements to Buyer/Sales or alter history. It can fill after procurement or invoice lock, but rejects dispatched/orphaned delivery tasks. Concurrent inserts retain the first event; failures leave CBM missing. Existing auth validates Warehouse membership before source reads. No new secrets or permissions.

Validation: 36 focused backend tests passed (6 new CBM cases plus 30 protected receiving/preparation/cost tests); syntax passes. Real public assets match baseline. Chrome candidate navigation was blocked by client; manual existing-tab open requested. No test business records created. No Apps Script edits. Wix has not been synchronized or published for this task. Pages release authorization and public verification remain pending.
