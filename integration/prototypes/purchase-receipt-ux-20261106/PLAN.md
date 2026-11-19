# Purchase receipt and supplier UX

Approved 2026-11-06: preserve live index.html/task-info.js/active-orders.css from0d19c3ab; first effective physical receipt permanently freezes that source's PO quantity; shortage/remaining cancellation use existing exception decisions, first Pay Slip retains full lock. Restore only personal drag handles and local automatic ordering, no Move Selected/destination popup or Activity write.

Other requested changes: orange unselected Transport; Supplier/Action headers; no typed supplier-plan reason; show existing quantity/price/transport amendment evidence in collapsed footer; root demand-left and child source-right quantity divider alignment; normal Row weight; PO date/actor stack; red actionable receipt variance; compact receipt/allocation details; receipt date; background receipt refresh protects drafts and original save recovery.

Recovery: live0d19c3ab/build20261106-supplier-dialog-image-v2, Pages42152787762/96 exact resources, both Wix live. Original files under root handoff/purchase-receipt-ux-20261106. Existing annotated verified workflow tag retained. This branch is not main; user confirmation/main merge pending.

Fresh originals: purchaseOperations.js, purchaseSources.js, purchaseProjection.js, purchaseOperations.web.js and warehouseReceiving.js exactly match checkout after newline normalization. All8 static originals match prior release package. Explicit approval covers the3 raw-source differences; all runtime changes start from those protected originals.

Acceptance: no-receipt amendment permitted; accepted/rejected receipt including later zero correction locks quantity; borrowed stock alone does not lock supplier quantity; received-after-prepare rejected before writing; already-committed request recovery preserved; paid lock unchanged; other source unaffected; personal ordering writes no CMS; receipt updates do not replace dirty drafts. No existing receipt/payment/Loaded will be replayed.
