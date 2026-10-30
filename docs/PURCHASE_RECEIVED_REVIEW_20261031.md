# Replenished receipt review

The stress test found that a completed replenishment still opened Purchase's shortage decision: it said received cartons were below the P.O. quantity while showing equal quantities and zero outstanding. The canonical quantity case deliberately retains the original exception for Finance, so deleting that case or declaring financial clearance would be incorrect.

The isolated client patch reuses the existing dialog. A case with exactly zero outstanding and explicitly cleared Warehouse receiving issues opens a read-only Receipt Review with the original feedback and current totals. It has no supplier waiting decision or confirmation action. Real shortages, unresolved damage and unknown receipt states retain the existing decision flow. The corresponding accessible button label identifies a receipt review rather than a zero-carton shortage.

No activity, financial state, allocation, stock, source identity, permission or file changes are made by opening this review. The shared case remains available to Finance. The previous `cbf572a` release is the recovery package; personal row preferences and prior business-save reconciliation remain unchanged.

Fresh public `app.js` and `index.html` matched the previous approved package byte for byte before editing. The current Wix Purchase page also matched its repository source after newline normalization. The exact private business evidence and source captures remain outside the repository.

Six focused scenario checks passed: replenished receipt, actual shortage, unresolved issue, unknown issue, unknown quantity and compiled-client/no-write behavior. The scoped stager extends the existing assembled production package and changes only Purchase `app.js` and `index.html`, preserving the other 92 resources. It excludes backend code and private evidence. The release workflow uses only `purchase-received-review-only`; other upload paths are guarded off.

Implementation and local tests do not constitute publication. Pages deployment, Wix version synchronization/publication and public functional acceptance must be recorded separately. Do not merge into `main` or create a user-verified baseline before user testing.
