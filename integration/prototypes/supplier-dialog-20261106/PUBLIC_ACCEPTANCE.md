# Public acceptance — supplier split and Submit image

Completed 2026-11-06 in foreground Chrome on the public Purchase page. This supersedes earlier blank-page/pending acceptance notes in REVIEW.md.

## Four release stages

- Code: supplier runtime `48596644` (PR359), orange ALLOC icon follow-up `0d19c3ab` (PR360). Subsequent `c03670b2` adds tests/documentation only.
- Pages: build `20261106-supplier-dialog-image-v2`, run42152787762,96/96 resources matched. Original7 deployment rules restored.
- Wix: four relevant backend drafts and Purchase version matched; MASTER and FMCG both confirmed published and live.
- Public: v2 loaded in a fresh foreground visit. Saved PO presentation, financial lock, orange ALLOC icon, real Submit image, individual source saves and reopen verified. Captured console errors: none. No deployment repeated during these acceptance checks.

## Observed scenarios

1. Existing AVATA AJAX demand500: saved supplier300 and exactly one WAITING200. Existing amendment500→300 remains visible; saved PO fields are plain text with its pencil.
2. Existing paid NCT-PO-NIGHT-7UP-1105: lock and bilingual prohibition, no editable fields, pencil or Save. Only Close. No existing PO was changed.
3. New authorized BEAUTY MAMA test:7UP2CTN,USD19.20,customerPO TEST-IMAGE-SPLIT-1106. Buyer request sent once, Sales Submit to NCT once; MASTER confirmed06/11/2026 11:58:29 MYT. Product image loaded1024×1024 in the actual supplier popup.
4. New test supplier1 HONG LEA quantity1,Supplier Deliver; supplier2 KOH SOON HUAT quantity1,Self Collect. Both used existing Catch Cost referenceMYR33.70/CTN. Reducing first draft2→1 generated exactly one WAITING1.
5. Saved first source once: summary saved1,currentplan2,waiting0; second source retained supplier,quantity,cost,transport and Customer order purpose control. Saved second source once: summary saved2,currentplan2,waiting0,totalMYR67.40. Closed and reopened through the actual supplier child-row button; both sources and image remained.

## Retained test record and limits

- Order `ORD-CUS-261103-CF0D88-BBC04C7F8D644064A201F0842AC1BD0A`.
- MASTER root `ee162a6b78d69027852d10de0a22d827`; second supplier source `9174849401253b9b18b0283d8ba38f08`.
- Two saved supplier plans remain for user inspection. No purchase PO, receiving, inventory, Loaded or payment was created by this acceptance test.
- Reserved AVATA1CTN Sales test ending `6F60347F0D18461FAFB08F94DFF0CF63` was not submitted or edited.
- Existing missing images were not backfilled. Batch/isolation/retry tests remain offline evidence; this new public path verifies a real owned selection image through Submit.
- Intermittent blank-page root cause is not claimed fixed. Existing broader CMS/download backlog is separate. Main merge/user-verified tag awaits user confirmation.

## Evidence

Local screenshots under `C:/FMCG-WIX-LOCAL/handoff/supplier-dialog-20261106/`:

- `public-saved-300-waiting-200.png`
- `public-finance-locked.png`
- `test-order-received.png`
- `test-order-master-confirmed.png`
- `public-new-submit-image.png`
- `public-row-one-saved-draft-preserved.png`
- `public-split-reopened.png`

Orange icon evidence: `handoff/alloc-hand-20261106/public-active-verified.png`.

User test: open BEAUTY MAMA7UP2CTN supplier popup to inspect image and two saved sources. Existing AVATA AJAX shows300+WAITING200. A paid PO must display its lock without edit controls. Do not repeat test Submit.
