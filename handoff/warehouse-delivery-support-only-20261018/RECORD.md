# Warehouse delivery chat: Support only

One warehouse renderer call now uses the existing cell renderer with peer SUPPORT and kind DELIVERY. Incoming Tasks retains its Purchase PO chat. Shared chat, backend permissions, storage, existing history, receipt, preparation, loading, dispatch and invoicing are unchanged. Warehouse HTML workroom cache key and its Wix entry build pointer are versioned.

Recovery: b002bb6 (functional staff headers 17b1026), annotated verified/department-ui-before-20261018. Fresh public workroom.js and Wix Warehouse entry both exactly matched repository before editing; private originals saved in root handoff/warehouse-delivery-support-only-20261018.

Validation: JS syntax passed; 18 existing warehouse receiving/preparation/task chat workspace tests passed. Chrome local synthetic Incoming Tasks retains P; Delivery Tasks has 0 P and 3 S, clicking S opens Support heading. No real data/messages created; MASTER remains reset for user acceptance. Code ready; Pages, Wix publish and public new version still pending.