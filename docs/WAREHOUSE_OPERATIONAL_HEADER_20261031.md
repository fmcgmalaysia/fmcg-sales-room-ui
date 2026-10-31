# Warehouse operational header

User correction: customer PO has no Warehouse role. Warehouse Receiving uses the Purchaser-issued supplier PO. Delivery remains authorized customer plus Desk work and needs customer ETD and Last Gate In including time. Do not rename customer PO as procurement PO or fabricate a procurement-source mapping.

MST-02 removes only the customer PO span from the Delivery header and `poNo` from the Warehouse delivery reference whitelist, including current Desk references and save/retry receipts. Receiving PO number, SO, shipment fields and other operational data remain unchanged. No procurement PO file containing costs is newly exposed. ETD and Last Gate In use the existing current authorized Desk shipment context; original snapshots remain evidence.

Fresh full Wix `warehouseDeliveryView.js` normalized SHA256 before patch: `b60039f0bebc8ce7f6e2aed9a76c9205e01be22a0d1c26c664f1ac2a52516a14`, identical to repository. Minimal draft replacement removes one whitelist key; full readback exactly matches expected candidate. Originals are retained privately in root `handoff/master-urgent-closeout-20261031/`.

Validation: 3 new operational-header cases and 27 existing delivery/privacy/receiving checks pass. This suite intentionally updates the old assertion that expected customer PO in the Warehouse response; it now requires absence in both reference locations. Supplier procurement PO, current ETD/time, no money/files leakage, single Loaded, partial receipt, duplicate receipt, stale input and company/role boundaries remain covered.

Release `warehouse-operational-header-only`, build `20261031-warehouse-operational-header-v1`, composes the independently committed MST-03 quantity display candidate. Compared with current public `26ff1a1` static composition, 99 resources remain, exactly 4 change: `master-shared/desk-delivery.js` and three consuming HTML version references. Only `warehouseDeliveryView.js` changes in the backend; three Wix page version references update. Preserve independent receipt repair `fc76b37` and current journal `97f9623`.

Recovery: restore the original Warehouse delivery projection and three original Wix page references; use the existing `purchase-quantity-style-only` generator for exact preceding public assets. No CMS migration, record deletion, stock movement, PO amendment or cost-source change is part of this release. Do not mark a new verified tag or merge main before user acceptance.

Code tested; GitHub sync, Pages, Wix publish and public verification must be recorded separately when completed. Other register issues are not declared complete by this release.
