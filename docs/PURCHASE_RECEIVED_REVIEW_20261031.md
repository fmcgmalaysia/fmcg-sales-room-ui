# Replenished receipt review

The stress test found that a completed replenishment still opened Purchase's shortage decision: it said received cartons were below the P.O. quantity while showing equal quantities and zero outstanding. The canonical quantity case deliberately retains the original exception for Finance, so deleting that case or declaring financial clearance would be incorrect.

The isolated client patch reuses the existing dialog. A case with exactly zero outstanding and explicitly cleared Warehouse receiving issues opens a read-only Receipt Review with the original feedback and current totals. It has no supplier waiting decision or confirmation action. Real shortages, unresolved damage and unknown receipt states retain the existing decision flow. The corresponding accessible button label identifies a receipt review rather than a zero-carton shortage.

No activity, financial state, allocation, stock, source identity, permission or file changes are made by opening this review. The shared case remains available to Finance. The previous `cbf572a` release is the recovery package; personal row preferences and prior business-save reconciliation remain unchanged.

Fresh public `app.js` and `index.html` matched the previous approved package byte for byte before editing. The current Wix Purchase page also matched its repository source after newline normalization. The exact private business evidence and source captures remain outside the repository.

Six focused scenario checks passed: replenished receipt, actual shortage, unresolved issue, unknown issue, unknown quantity and compiled-client/no-write behavior. The scoped stager extends the existing assembled production package and changes only Purchase `app.js` and `index.html`, preserving the other 92 resources. It excludes backend code and private evidence. The release workflow uses only `purchase-received-review-only`; other upload paths are guarded off.

Implementation and local tests do not constitute publication. Pages deployment, Wix version synchronization/publication and public functional acceptance must be recorded separately. Do not merge into `main` or create a user-verified baseline before user testing.

## Release acceptance, 2026-10-31

- Code: runtime `10e2a88e2a56da5f75de4d54cfc542a665c91c7e`; Wix reference record `775f3d3`; draft PR249. User acceptance is pending; `main` is unchanged.
- Pages: build `20261031-purchase-received-review-v1`, run `41104947189`, attempt 1 succeeded. All 94 published resources were compared. 93 match the Windows package exactly; `display-rows.js` has the previously approved Linux LF representation and matches its Git blob. Only Purchase `app.js` and `index.html` changed functionally.
- Permissions: the single approved deployment completed; the temporary branch rule was removed immediately and the exact original seven rules restored.
- Wix: the current Purchase source matched the repository before editing. Only the version token changed. Full normalized readback matched the intended source, SHA256 `dc842f364eab4536a7790edba29fc6e7d1c8f5861537ed0be41511d6a46d0a96`. Wix confirmed published and live.
- Public: a native Chrome new tab opened the clean MASTER URL, loaded the new build, and displayed the replenished read-only Receipt Review with equal planned/received quantities, zero outstanding and only Close controls. Allocation/Loaded, cost and payment records remained unchanged. Captured errors on this fresh Purchase tab were empty. The original user's unsaved Purchase tab was untouched.

### Separate production backend component

The production Warehouse receipt fix is `fc76b37bcd1c2edd2098d8802707f4c323140b2c`, draft PR250, on `fix/warehouse-receipt-version-20261031`. It is intentionally **not** present in this frontend branch's backend file. Do not overwrite the live backend using this frontend checkout. Before the final Wix publication the live `warehouseReceiving.js` was read back and its normalized SHA256 remained `447337a9cd68348f5577ae7834f83fec8857b982be21f4493517a7b12fc1d84e`.

That backend was separately published and accepted through a real concurrent document-upload/receipt scenario: the original receipt form completed without re-entry and produced exactly one receipt. Nine new checks passed. The larger suite has the same 26 failures on the captured original and candidate (329/355 versus 338/364 passing), with zero new failure names; these historical failures remain unresolved and must not be represented as a completely passing regression suite.

Private evidence and the detailed business report are under root `handoff/master-stress-four-scenarios-20261031/`. They contain business records and must not be copied into the public repository. The four requested real scenarios completed, with test records retained for the user's review. This is publication acceptance, not a new user-verified production baseline.
