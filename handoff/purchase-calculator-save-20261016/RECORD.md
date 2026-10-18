# Purchase calculator and partial procurement acceptance — 2026-10-16

Scope: calculator formatting/navigation, Save-to-P.O. action visibility, partial procurement child rows, column widths, and the two explicitly authorized real Purchase tests. No new P.O. number, warehouse receipt, Account connection, permission change, or unrelated business operation was performed.

## Recovery and code

- Branch: `fix/purchase-calculator-partial-save-20261016`; draft PR100. Main is unchanged and remains subject to user acceptance before merging.
- Previous code recovery point: `539c140`; existing annotated checkpoints `verified/purchase-allocation-layout-20261015` and `verified/purchase-lavender-plan-po-20261014` retain their original, limited acceptance scope.
- Code: UI `9682222`, known no-change P.O. feedback `3824219`, semantic price readback comparison `24f0494`, narrowly scoped reference-price gate `76b18da`, Wix v2 pointer `afae6c3`.
- Real CHIPSMORE procurement has been saved at 35. Do not restore the earlier 25-box business record or submit 35 again merely to repeat this test.

## Findings and minimal changes

- Formatting displays two decimals and percentages; keyboard arrows/Enter move between editable costing fields. Original precision is retained in the calculation, rather than rounded on blur.
- An unsaved supplier row shows no P.O. action. A positive calculated Net Cost enables an orange Save action. Only a confirmed matching workspace receipt switches Save to white/disabled 已保存 and reveals orange P.O. Existing assigned P.O. behavior is retained.
- Footer is Cancel / Save. Active Since is 90px; Customer and Supplier are both 128px; remaining width belongs to Description.
- A single saved supplier with only part of demand now renders its actual procurement child and the remaining WAITING child. Existing full single-supplier behavior is retained.
- The first real CHIPSMORE save wrote successfully but v1 falsely reported a mismatch: CMS reordered keys in the price JSON. The comparison now compares the five price values in a fixed order; real value differences still fail confirmation. A regression test failed before this one-line fix and passes after it.
- ECLIPSE Catch Cost was rejected because its product cost status included missing CBM, despite all five price inputs being present. The backend exception permits only ACTIVE products whose issues are exclusively UNAVAILABLE_CBMPERCTN and whose five price fields are finite. All original company, barcode, currency, timestamp and staff checks remain. Other errors and incomplete prices remain blocked.
- The observed unchanged-P.O. exception was added to known error feedback. Earlier WDE0118 retries do not prove that original request was cleared; the user subsequently opened a fresh formal tab. No existing P.O. number was changed.

## Real public acceptance, performed in the existing Chrome Purchase tab

Permanent URL: https://fmcg999.wixstudio.com/master

Fresh public iframe confirmed `purchase-live/?v=20261016-purchase-calculator-save-v2` after the user manually refreshed. No dirty formal page was reloaded by the agent.

1. CHIPSMORE, customer demand 50: the real save at 11:25:12 MYT changed procurement 25 to 35. Fresh v2 showed mother `50 | 35`, supplier child 35, WAITING child 15, amount MYR 2,886.41. Opening the saved plan showed white disabled 已保存 and orange P.O.; no false mismatch. This was a readback, not another submission.
2. ECLIPSE, customer demand 100: HONG LEA was explicitly chosen by the user. Real Catch Cost returned LP/Pc 4.95, LP/Ctn 475.20, Disc1 3.00%, Disc2 1.00%, Disc3 0.00. No price was invented.
3. FOC paid100 + free10 calculated total110, average Net Cost MYR414.85, amount MYR45,633.46 and expected surplus10. Before Save, P.O. was hidden and Save orange. The agent saved once with the user's test reason. The real confirmed response showed 此来源已保存, white disabled 已保存 and orange P.O.; no mismatch or relevant error.
4. Stock Allocation showed ECLIPSE/HONG LEA expected stock10, Awaiting warehouse, unallocated0, Allocate disabled. This is expected stock, not received available stock. No warehouse receipt was entered.
5. Returning to Active showed ECLIPSE demand100/planned100 and Stock +10, preserving customer demand. Pending P.O. rose from2 to3 because the newly saved source still has no P.O.
6. On real ECLIPSE inputs, ArrowRight moved focus from LP/Pc to LP/Ctn without changing quoted values. The fields displayed two decimals. Cancel and Save were visible in English. Active colgroup readback was 56/40/90/128/auto/96/128/92/104/96/132px.
7. Allocation P.O. and main-table P.O. both invoke the same `poDialog` / savePo path. One successful P.O. confirmation is final; a second main-table confirmation is not required. No test P.O. number was created.

## Validation and publication stages

- Relevant automated suite: 158 passed, 0 failed, covering action gating, receipt comparison and real differences, formatting precision, keyboard navigation, partial demand/WAITING, FOC stock, reference-price eligibility, error feedback and protected allocation behavior. The pre-existing CRLF-only change in purchase-allocation-drafts.test.cjs remains unstaged.
- Code version: `afae6c362f0a86841d68482ed2d217efc2b4947b` (runtime code identified above); acceptance documentation follows in a separate commit.
- GitHub Pages: v2 run38845681277 succeeded at `24f04945146bbcf27d81a46577fee48fcb3c65fa`. Build `2026-10-16-purchase-calculator-save-v2`; all31 public assets matched normalized repository contents. Temporary policy63228118 removed; original7 policies restored exactly. Backend-only 76b18da and Wix pointer afae6c3 do not change these static assets.
- Wix Studio: fresh full page/backend comparisons preserved before edits; only scoped changes applied; exact readbacks and published/live receipt captured. Full source snapshots are retained locally with hashes in evidence-hashes.json.
- Public verification: fresh v2 real Purchase page verified with the two authorized business saves/readbacks and stock state above. This completes these scoped publication stages; it does not constitute user acceptance for merging to main, new integrations, or unrelated workflows.

Local evidence directory: `C:/FMCG-WIX-LOCAL/handoff/purchase-calculator-save-20261016/`. Selected evidence includes chipsmore35-confirmed-v2.png, eclipse-before-foc-save.png, eclipse-foc-confirmed-v2.png, eclipse-stock10-v2.png, active-final-v2.png, v2-publish-receipt.png and exact Wix snapshots. The complete private order trace is retained locally, not included in this record.
