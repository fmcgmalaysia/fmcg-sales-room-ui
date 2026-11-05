# Support original upload recovery

Approved scope: restore a verified employee's original failed upload after page memory is lost, retaining the request and allocated file IDs. Complete customer-file, Finance receipt and Buyer/Sales acceptance without replaying orders, Loaded or invoices.

## Baseline and minimum change

Fresh Wix originals for `supportDocuments.js`, `supportWorkroom.web.js` and the Support page match the checkout. The user separately approved retaining the two formal Support static originals; they exactly match the current96-resource release package and retain all three post-SI Desk refresh reads. Exact originals and private evidence are in the root handoff `support-original-upload-recovery-20261105`.

- Existing authenticated Support document read projects only the same employee/company's unresolved PREPARED intents. Original journal, document and file identities must agree. Reconstructed input must match the original digest; ambiguous/unverifiable intents block new upload instead of inventing input.
- The existing dialog displays Resume Original Upload, locks original metadata, and requires selecting the exact original PDF by SHA256 and size. It calls the same save method with the original request; no new UUID or file allocation is used.
- An independent attachment can finish before another pending request. The original full validation is reused with the fixed allocated identity and original timestamp. Any changed original metadata or Finance basis is rejected. Legacy intents without a Finance basis are conservative: changed document version is accepted only when no Finance posting exists and the original full context still validates exactly.
- Two small fields in the existing plan preserve input version and a hash of Finance evidence; no new CMS rows, collections, indexes, cache, ledger or endpoint are introduced by reads. The Finance hash is canonical and order-independent.
- Confirmed documents remain the source for successful-outcome recovery; saved evidence is not offered for automatic reupload. Existing file service delivery, sharing, staff validation and stock rules remain unchanged.

## Validation

123 selected checks pass:16 new,107 existing. They cover legacy archived SI plus customer proof recovery with unchanged stock/SI, same-request replay, independent attachments, wrong PDF/amount, current employee/company/Desk/batch, ambiguous intent, changed Finance evidence, CMS object-field order, real dialog and submit handlers, and93 unchanged public assets. Both actual saved intents additionally passed offline digest/PDF/allocated-file matching using private source evidence. Raw CSV/member/file metadata is not committed.

The local Chrome candidate URL timed out; component visual acceptance is not claimed. All public functional acceptance is pending deployment. No new business transaction was submitted during development.

## Release boundary

Branch: `fix/support-original-upload-recovery-20261105`.
Build: `20261105-support-original-upload-recovery-v1`.
Workflow mode: `support-original-upload-recovery-only`.
Static package:96 resources,3 changed (`support-room/workroom.js`, `support-room/workroom-model.js`, `support-room/workroom.html`),93 byte-identical to the current formal package.
Wix:two backend modules and one Support version reference. Apps Script stays on the same deployment Version12. Do not redeploy the file service or repeat the completed privacy maintenance.

Before release, require exact full Wix draft readbacks and the concrete action-time branch deployment approval. After release verify all96 hashes, remove the temporary branch rule and restore the exact original seven, obtain Wix published/live, then test the real Support/Finance/Buyer/Sales workflow. Do not merge main or mark user-verified yet.

## Formal acceptance still required

1. Reload Support, open the original SI/proof and see Resume Original Upload; wrong PDF is refused without save; exact original file completes once on the same IDs.
2. Finish both original intents before posting customer receipts. Original file events and results occur once; all Loaded/SI/supplier payments remain unchanged.
3. Finance confirms the first customer receipt against the intended SI. Support references alone must never mark it paid. Verify matching Buyer/Sales balances; then repeat with a distinct second proof/receipt once.
4. Verify actual customer PDF access/download and return navigation. Existing normal-tab preview is not proof of Buyer-path download.
5. Stock stays0 in NCT/GHR; second SI and other customer's debt stay independent. Final Activity count must be measured, not guessed.
