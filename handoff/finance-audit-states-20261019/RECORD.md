# Finance Audit button states

Status: local candidate only. Not pushed, deployed, synchronized to Wix, or published.

Release marker prepared after user authorization and advanced after the final visual corrections: build `2026-10-19-finance-audit-v11`; Wix pointer `20261019-finance-audit-v11`.

Recovery point: published `8da03d8` (`8da03d86e931748b8394d4d6202ecaf045e96ba2`).

Single objective: make the Supplier Accounts Audit control express the user-defined lifecycle without changing settlement data or backend eligibility.

User-facing mapping:

- No confirmed supplier payment yet: neutral gray rectangular `Audit`, disabled.
- Confirmed payment exists, or the supplier liability is validly settled: orange rectangular `Audit`, enabled.
- Paid record has a receiving or stock risk and no current linked CN: red rectangular `Audit`, enabled.
- Adding a current linked CN restores the enabled Audit control to orange.
- A completed supplier audit appears in History as a transparent rectangular button with a blue outline and blue check.
- A completed audit with a new review requirement retains the existing red review entry.

The enabled orange or red Audit button opens the compact blocker summary. Only the existing backend `supplierAccount.canClose` result exposes `Complete Audit` inside that summary. The existing `CLOSE_ACCOUNT` action and every server blocker remain unchanged.

Changed frontend files:

- `account-room/payment-layout.js`
- `account-room/payment-layout.css`
- `account-room/settlement.js`
- `account-room/purchase-payments.js` (earlier Active/History candidate in the same branch)

Focused verification: 49 of 49 Finance tests pass, including explicit gray, orange, red, CN-restored orange and completed blue-outline cases. JavaScript syntax and diff whitespace checks pass. Chrome local synthetic preview verified all Audit states. No production records were read or written during this candidate verification.

The gray, orange and red Audit controls are 48 px wide by 28 px high with 4 px corners, matching the Docs button height. The completed check retains a 48 by 28 px click target but has no rectangular border or fill.

The completed blue check uses an open-circle checkmark whose tick extends toward the upper right, matching the user's supplied shape while remaining a repository-native SVG and retaining the rectangular button dimensions.

All enabled Finance buttons now use the exact Purchase interaction recipe: one-pixel lift, slight brightness change and a compact shadow on hover or keyboard focus, followed by the Purchase pressed state. Finance text-entry buttons underline on hover or focus. Disabled controls remain unchanged, and reduced-motion users retain a stationary interface.

## Warehouse column follow-up

The same local candidate now labels the former `Receiving` column as `Warehouse`. It displays planned and received cartons as `planned | received`, without a separate negative-difference badge or the old `of ... CTN` sentence. An unresolved receiving or stock issue renders only the received value as a red capsule. Clicking that capsule opens a small auto-dismiss popover reading `Purchaser Resolution: ...`, sourced directly from the existing Purchase `receiptLines[].decision.supplierDecision`. No new data field, synchronization, writer, or resolution action was added.

Before Wix synchronization, the user corrected the abnormal received capsule height. A fresh read of the actual public Purchase `95` capsule established the authoritative dimensions: 34 px minimum width, 19 px height, 11 px text, 14 px line height, 6 px horizontal padding and 12 px radius. Finance now uses those exact values rather than the earlier approximation.

Clicking the abnormal received capsule retains the native auto-dismiss popover but presents it above and to the right of the capsule as a compact WhatsApp-style light-green chat bubble (`#d9fdd3`) with black text and a small pointer aimed back at the capsule. Its content-sized width and visible overflow prevent either scrollbar. The stored Purchase resolution source and mappings are unchanged.

The Supplier Accounts table now uses balanced explicit widths for all nine columns. Warehouse reserves equal left and right halves around a fixed center separator: the planned value is right-aligned, the received value is left-aligned, and either side accommodates `9999`. The separator is centered under the `Warehouse` header. Docs, Pay Slip and Audit remain centered while Message retains a dedicated readable width. This is layout-only; row values and state logic are unchanged.

All Finance PO, PI, DO, INV and CN document dialogs now omit Download while retaining View and Report Issue. Correction cards also retain View without a Download action. The document dialog width is reduced from 640 px to 520 px. Payment proof controls remain outside this DOCS-only change.

The Active and History tabs now display their full task-row totals for the current company. Supplier Account History is intentionally cumulative, not limited to the current month: it shows every returned P.O. whose supplier audit is closed. Search and Supplier filters continue to affect the separate visible `records` count without changing the tab totals or storage rules.

Supplier Accounts now presents two non-interactive blue dashboard cards on the right of the title. They summarize the currently displayed task rows: Task and distinct Involved Suppliers in the first card, then Total Amount and confirmed Partially Paid value for rows that still have an outstanding balance in the second. Unknown payable bases render as `—` instead of a misleading zero. The cards do not add navigation, writes or business-state changes.

Focused verification is now 53 of 53 tests. The fixtures verify `500 | 480`, no `-20`, the mapped Purchase resolution, the exact nine-column widths, reserved `9999 | 9999` capacity, the absence of Download from every Finance DOCS popup and correction card, and the dashboard-card totals for a partial-payment example. Chrome local synthetic preview measured the Warehouse header, cell and separator at the exact same center coordinate, with zero-pixel alignment error. The narrowed document dialog measured 520 px wide with no horizontal overflow, no Download text, and retained View and Report Issue. The two dashboard cards measured 190 px by 86.8 px each, shared one aligned row, used the approved blue `#2563EB`, contained no link or button, and did not overlap the title area. The red capsule, compact popover and automatic dismissal remain intact.
