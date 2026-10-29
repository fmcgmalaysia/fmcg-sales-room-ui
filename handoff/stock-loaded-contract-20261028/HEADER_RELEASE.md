# Support details publication — 2026-10-29

- Runtime code: 6971fb1315f8ebc36f9814ce65ecb302f2db5397, build 20261029-support-details-v1. PR236 remains a draft; main is unchanged and user transaction acceptance remains pending.
- GitHub Pages: workflow40866660309 succeeded. All92resources match the preserved release manifest; the9retired standalone resources return404. Only support-details-only was dispatched, once.
- Temporary branch rule64780544 was removed immediately after workflow success. The original7deployment rules matched exactly after restoration.
- Wix: all13module/page sources matched their intended complete contents following minimal synchronization. Wix Studio explicitly confirmed “This site is published and live online.” The publication receipt and source hashes are preserved separately.
- Public checks: Support, Warehouse, Purchase and Finance were refreshed on their actual Wix public pages. Support's compact header, section-title pencils, combined details dialog, manual-deposit/no-posting note, reserved Booked By, gate-in date/time, invoice-number draft and original SO upload dialog were inspected. Desk1→2→1 returned task counts2→0→2 without Retry Desk Save. Dialogs were closed without saving.
- Warehouse: Incoming and Delivery Task render correctly. The actual Delivery Task HTTP200response uses deskDeliveryVersion2, returns only company/version/readAt/staff/department/lists and contains no commercial payload. No unapproved future customer tasks appear. The actual initial Receiving HTTP200response was searched for price, amount, cost, deposit, financial, invoice, currency and cents: zero matches. The same response search finds3documentsfields as a positive control. No production transaction was submitted.
- Purchase: Dashboard, customer task table and Stock Allocation render correctly, retaining the existing shortage alert and receipt sources. Finance's existing3Awaiting Review records and document actions remain visible. Warehouse console shows only the already-known Wix unload-policy violations; no relevant application error was observed.

## Acceptance boundary

The current public Desk has no assigned allocation, so Open Task to Warehouse is correctly disabled and Warehouse has no authorized Delivery Task. Real authorization, Loaded submission, cross-room confirmed quantities/red shortfall state and same-request retry were tested with the actual backend factories and staged pages in isolation, including7financially screened Warehouse responses. Their production business writes remain for the user's real workflow test. Do not invent shipment movements or claim user verification from these read-only checks.

Manual deposit does not create a financial posting. Invoice-number entry remains a draft until the existing formal invoice process succeeds. Red shortfall clearing authority, mandatory-photo policy, complete remainder split/cancellation/partial-invoice rules, borrowing/month close and historical CMS archive remain separately unfinished work.

Related regression remains241/242passed; the single pre-existing Sales/Buyer wording assertion is documented in HEADER_VALIDATION.json. Five scoped Warehouse privacy/interface tests passed again after the live page patches were prepared. This publication is a candidate for user acceptance, not a replacement verified production baseline.
