# Finance Audit button states

Status: local candidate only. Not pushed, deployed, synchronized to Wix, or published.

Release marker prepared after user authorization: build `2026-10-19-finance-audit-v1`; Wix pointer `20261019-finance-audit-v1`.

Recovery point: published `8da03d8` (`8da03d86e931748b8394d4d6202ecaf045e96ba2`).

Single objective: make the Supplier Accounts Audit control express the user-defined lifecycle without changing settlement data or backend eligibility.

User-facing mapping:

- No confirmed supplier payment yet: neutral gray circular `Audit`, disabled.
- Confirmed payment exists, or the supplier liability is validly settled: orange circular `Audit`, enabled.
- Paid record has a receiving or stock risk and no current linked CN: red circular `Audit`, enabled.
- Adding a current linked CN restores the enabled Audit control to orange.
- A completed supplier audit appears in History as a 28 px transparent circular button with a blue outline and blue check, matching the Pay Slip button size.
- A completed audit with a new review requirement retains the existing red review entry.

The enabled orange or red Audit button opens the compact blocker summary. Only the existing backend `supplierAccount.canClose` result exposes `Complete Audit` inside that summary. The existing `CLOSE_ACCOUNT` action and every server blocker remain unchanged.

Changed frontend files:

- `account-room/payment-layout.js`
- `account-room/payment-layout.css`
- `account-room/settlement.js`
- `account-room/purchase-payments.js` (earlier Active/History candidate in the same branch)

Focused verification: 49 of 49 Finance tests pass, including explicit gray, orange, red, CN-restored orange and completed blue-outline cases. JavaScript syntax and diff whitespace checks pass. Chrome local synthetic preview verified the 40 px circular gray disabled, orange enabled and red enabled states; the completed check is 28 px to match Pay Slip. No production records were read or written during this candidate verification.

## Warehouse column follow-up

The same local candidate now labels the former `Receiving` column as `Warehouse`. It displays planned and received cartons as `planned | received`, without a separate negative-difference badge or the old `of ... CTN` sentence. An unresolved receiving or stock issue renders only the received value as a red capsule. Clicking that capsule opens a small auto-dismiss popover reading `Purchaser Resolution: ...`, sourced directly from the existing Purchase `receiptLines[].decision.supplierDecision`. No new data field, synchronization, writer, or resolution action was added.

Focused verification is now 48 of 48 tests. The added fixture verifies `500 | 480`, no `-20`, the `Warehouse` header, and the mapped Purchase resolution. Chrome local synthetic preview verified the red capsule, compact popover, and automatic dismissal after clicking elsewhere.
