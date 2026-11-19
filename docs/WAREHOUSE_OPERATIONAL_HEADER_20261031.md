# Warehouse operational header

User correction: customer PO has no Warehouse role. Warehouse Receiving uses the Purchaser-issued supplier PO. Delivery remains authorized customer plus Desk work and needs customer ETD and Last Gate In including time. Do not rename customer PO as procurement PO or fabricate a procurement-source mapping.

MST-02 removes only the customer PO span from the Delivery header and `poNo` from the Warehouse delivery reference whitelist, including current Desk references and save/retry receipts. Receiving PO number, SO, shipment fields and other operational data remain unchanged. No procurement PO file containing costs is newly exposed. ETD and Last Gate In use the existing current authorized Desk shipment context; original snapshots remain evidence.

Fresh full Wix `warehouseDeliveryView.js` normalized SHA256 before patch: `b60039f0bebc8ce7f6e2aed9a76c9205e01be22a0d1c26c664f1ac2a52516a14`, identical to repository. Minimal draft replacement removes one whitelist key; full readback exactly matches expected candidate. Originals are retained privately in root `handoff/master-urgent-closeout-20261031/`.

Validation: 3 new operational-header cases and 27 existing delivery/privacy/receiving checks pass. This suite intentionally updates the old assertion that expected customer PO in the Warehouse response; it now requires absence in both reference locations. Supplier procurement PO, current ETD/time, no money/files leakage, single Loaded, partial receipt, duplicate receipt, stale input and company/role boundaries remain covered.

Release `warehouse-operational-header-only`, build `20261031-warehouse-operational-header-v1`, composes the independently committed MST-03 quantity display candidate. Compared with current public `26ff1a1` static composition, 99 resources remain, exactly 4 change: `master-shared/desk-delivery.js` and three consuming HTML version references. Only `warehouseDeliveryView.js` changes in the backend; three Wix page version references update. Preserve independent receipt repair `fc76b37` and current journal `97f9623`.

Recovery: restore the original Warehouse delivery projection and three original Wix page references; use the existing `purchase-quantity-style-only` generator for exact preceding public assets. No CMS migration, record deletion, stock movement, PO amendment or cost-source change is part of this release. Do not mark a new verified tag or merge main before user acceptance.

## Release acceptance — 2026-10-31

| Stage | Observed result |
| --- | --- |
| Code | Runtime `0d6b492104998ee10fe8532433f5baed395f9193`, PR269, includes independently committed MST-03. 75 distinct relevant checks passed across the two scopes. |
| GitHub Pages | Single approved run [41201581377](https://github.com/fmcgmalaysia/fmcg-sales-room-ui/actions/runs/41201581377), job124538271230 succeeded. Build `20261031-warehouse-operational-header-v1`;99 normalized assets and all manifest hashes match;95 byte-exact,4 line-ending differences only. |
| Deployment permission | The exact branch/commit/one-run grant was approved, used once, then removed immediately after workflow success. Original7 branches and0 tags restored and visually verified. |
| Wix Studio | All4 full drafts freshly read back and matched. One Publish action returned “This site is published and live online.” |
| Public pages | Fresh native Chrome navigation loaded Warehouse, Purchase and Support with the new build. Relevant captured error logs were empty. Results below. |
| User acceptance | Pending; no main merge or new user-verified baseline. |

Public read-only observations:

- Warehouse TESTING01 Desk1 retains SO TEST-SO-01, ETD2026-11-05 and Last Gate In2026-11-04 18:00, matching Support. Customer PO TEST-E2E-01 remains in Support and is absent from Warehouse; no monetary columns or financial document controls appear there.
- Warehouse TESTING01 Desk2 displays original Order Qty250, effective Alloc230, Loaded230 and Resolved. Support shows planned/Loaded230 and the existing20 cancellation remains accounted for without another stock write.
- TESTING801 Desk1 remains Alloc100, Loaded90, Short10. Purchase still shows Alloc100/Loaded90. This user test case was not resolved or modified by verification.
- Support Desk1→Desk2→Desk1 returns an identical DOM snapshot; original header and quantities remain.
- Warehouse Completed Incoming Tasks still lists8 records with Purchaser-issued supplier PO numbers, including NCT-PO-TEST-01 and NCT-PO-STRESS-A-LATE-1031.
- Ordinary tool reload reproduced the pre-existing blank Wix embedded frame despite the correct new source. Native Chrome new-tab navigation to clean production URLs loaded correctly. This release does not claim to fix that loading issue.

Private evidence: root `handoff/master-urgent-closeout-20261031/`, including PUBLIC_ASSETS.json, permissions-restored.png, wix-published.png, warehouse-header-public.png, warehouse-resolved-public.png, warehouse-unresolved-public.png and corresponding DOM records. No PO, payment, stock, allocation, borrowing, repayment or Loaded write was performed during this release verification.

MST-01 `dd60d43` and MST-04 `ced8531` remain separate background candidates; neither was included in this deployment. Other register issues are not declared complete by this release.
