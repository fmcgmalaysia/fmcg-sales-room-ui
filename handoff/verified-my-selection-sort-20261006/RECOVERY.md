# My Selection verified recovery checkpoint

User approved closeout on 2026-10-06. Protected order: FOOD before NONFOOD, then current CMS Brand Name and Sort No. Search and category filtering retain this order.

Production code commit: 8d78a57540868029b53690c961de1f05b69febd1. Annotated checkpoint tag: verified/my-selection-sort-20261006. Release evidence: ../my-selection-sort-20261006. Exact Wix page, backend and Buyer HTML snapshots are saved here; hashes are in baseline.json.

Recovery is scoped to these files. Restore only the changed sorting helper/renderMy call and two read-only workspace fields when reverting this task; compare live code first. Do not replace other working workflows or revert customer/order data. Pages deployment and Wix publish/public verification are required for a release recovery.

Apps Script, QD template and CMS schema were not changed. The public account had eight Food selections and no Non-food selections; mixed-category precedence was verified with a local fixture. Existing quotation, quantity, download and history regression checks passed (25); actual Excel download was not rerun in this release.
