# Sales customer Selection column

Scope: combine the existing active Selected count and selection allowance in one `Selection` column, rendered as `2/100 sku`; rebalance the ten customer columns. Unknown count remains an em dash, never an invented zero. Existing allowed limits 100/300/500/700 remain unchanged.

Baseline: `7d28c83`, with recovery tag `verified/buyer-selection-image-links-20261104`. Fresh public Sales HTML and fresh Wix Sales page matched the repository before edits. Wix draft is a single version-token replacement, exactly read back. No backend changes, extra CMS reads/writes, quotation publication, customer identity, file delivery, or Buyer entry changes.

## Count diagnosis

Selected is the count of current non-removed My Selection records, reused from `getSalesRoomQuoteSignals`. Risk is independently returned by the central service's `WIX_getQuoteRiskCounts`, scanning QD rows that contain a barcode or list ID, including retained rows no longer selected. A red signal or GP below 6% qualifies. Real read-only inspection confirmed two selected items while six QD rows had red signals, including four FAILED rows. Therefore Risk is not a subset of Selected. No QD rows or risk rules were modified by this layout patch. Aligning risk scope with active selections remains a separately scoped correctness task.

## Verification

- 13 focused checks passed: active selection counting and staff isolation, zero/unknown/invalid counts, allowed limits, ten matching cells, icon-before-count, Buyer new-tab behavior, script parsing, existing history file delivery, and 101-resource packaging.
- Related suites: 50 of 56 checks passed in aggregate. Six pre-existing failures were reproduced against the unchanged baseline: five Buyer historical UI tests reference retired `allCompletedRows`; one launcher test expects an obsolete green CSS literal. A new Selection-header expectation naturally fails against the old two-column baseline and is not counted as a pre-existing failure.
- Scoped package verifies all 101 baseline hashes, changes only `index.html`, and preserves 100 other assets including the latest Buyer quantity UI.
- Chrome local table preview verified the six-row layout. Public layout verification remains required after Pages and Wix publication.

## Release stages at preparation

1. Code: ready for GitHub synchronization.
2. Pages: not deployed; scope `sales-selection-layout-only`.
3. Wix: exact single-page draft saved, not published.
4. Public: original live table inspected; new table not yet public.

No claim of completed publication until all four stages pass. Existing verified Excel downloads and the two submitted test orders remain untouched.
