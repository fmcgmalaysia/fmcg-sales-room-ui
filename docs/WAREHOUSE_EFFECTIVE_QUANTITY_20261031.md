# Warehouse effective Desk quantity

MST-03 published as part of `0d6b492` with MST-02; technical public verification passed, user acceptance pending. See WAREHOUSE_OPERATIONAL_HEADER_20261031.md for the combined release evidence.

The Warehouse Alloc cell and Loaded dialog caption now read the existing `resolution.maximum` when present. An authorization of 250 with 20 cancelled or transferred displays 230; a decision to continue loading retains 250. The immutable authorization, customer order quantity, stock ownership, physical deductions and save handlers are unchanged. Nullish fallback preserves a real maximum of zero.

Recovery: current public static composition `26ff1a1`, build `20261031-purchase-quantity-style-v1`; current backend `97f9623` including independent receipt correction `fc76b37`. Prior user-verified tag `verified/stop-waiting-cn-20261026` remains protected; this candidate is not a new user-verified baseline. Main stays unmerged.

Fresh public `desk-delivery.js` equals the generated baseline, normalized SHA256 `c7d90bdb23d9c0c71f37d5ddcc88f3cb6844ddb9a79d52d58da6b9d52a546ae3`. Purchase, Warehouse and Support Wix page originals were fully copied and compared with repository sources: all equal after CRLF normalization. Private originals and candidate screenshot are retained in root `handoff/master-urgent-closeout-20261031/`.

Validation: 7 new checks, 25 existing shortload cases, and 29 additional Desk delivery, privacy and Support planned/Loaded checks pass (61 distinct checks; the second command repeats the 7 new checks). Local Chrome renders cancelled and transferred lines at Alloc230/Loaded230/Resolved, and continued loading at Alloc250/Loaded230/Continue20. The actual Loaded dialog shows Alloc250, retained Loaded230 and remaining20. These fixtures use a read-only synthetic sender, not production data.

Release scope `warehouse-effective-quantity-only`: 99 static resources, only shared `desk-delivery.js` and three consuming HTML version references change. Three Wix version references change. Backend files, journals and CMS data do not change. The prior release generator provides exact recovery assets. All runtime handlers and other static assets are byte-preserved by the test.

| Stage | Status |
| --- | --- |
| Code | 3956ff9 composed into0d6b492;61 distinct quantity checks passed |
| GitHub Pages | Run41201581377 succeeded;99 assets verified |
| Wix Studio | Exact drafts read back; published and live confirmed |
| Public page | TESTING01 Desk2 Alloc230/Loaded230/Resolved; original801100/90/10 retained |
| User acceptance | Pending |

MST-02 is separate: Warehouse customer PO is explicitly unwanted. Receiving uses Purchaser-issued supplier PO; Delivery needs customer ETD and Last Gate In. This quantity-only candidate does not claim to finish that change or the other open register items.
