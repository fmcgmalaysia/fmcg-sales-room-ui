# Sales customer Selection column

Scope: combine the existing active Selected count and selection allowance in one `Selection` column, rendered as plain text `2/100 sku` without a capsule; rebalance the ten customer columns. Unknown count remains an em dash, never an invented zero. Existing allowed limits 100/300/500/700 remain unchanged. The user's follow-up requested removal of the candidate capsule; it was not approval to grant deployment access for the preceding commit.

Follow-up: RFQ and Risk cells are blank when the existing renderer has no positive count. Positive alerts retain their original styling and count. Risk's explicit unavailable-data em dash remains visible; no quotation-risk computation or backend read was changed.

Baseline: `7d28c83`, with recovery tag `verified/buyer-selection-image-links-20261104`. Fresh public Sales HTML and fresh Wix Sales page matched the repository before edits. Wix draft is a single version-token replacement, exactly read back. No backend changes, extra CMS reads/writes, quotation publication, customer identity, file delivery, or Buyer entry changes.

## Count diagnosis

Selected is the count of current non-removed My Selection records, reused from `getSalesRoomQuoteSignals`. Risk is independently returned by the central service's `WIX_getQuoteRiskCounts`, scanning QD rows that contain a barcode or list ID, including retained rows no longer selected. A red signal or GP below 6% qualifies. Real read-only inspection confirmed two selected items while six QD rows had red signals, including four FAILED rows. Therefore Risk is not a subset of Selected. No QD rows or risk rules were modified by this layout patch. Aligning risk scope with active selections remains a separately scoped correctness task.

## Verification

- 13 focused checks passed: active selection counting and staff isolation, zero/unknown/invalid counts, allowed limits, ten matching cells, icon-before-count, Buyer new-tab behavior, script parsing, existing history file delivery, and 101-resource packaging.
- Related suites: 50 of 56 checks passed in aggregate. Six pre-existing failures were reproduced against the unchanged baseline: five Buyer historical UI tests reference retired `allCompletedRows`; one launcher test expects an obsolete green CSS literal. A new Selection-header expectation naturally fails against the old two-column baseline and is not counted as a pre-existing failure.
- Scoped package verifies all 101 baseline hashes, changes only `index.html`, and preserves 100 other assets including the latest Buyer quantity UI.
- Chrome local table preview verified the six-row layout. Public layout verification remains required after Pages and Wix publication.

## Release result

1. Code: `4bc463e17dc180227710ebcd7a9512845b96c2ba`, GitHub PR340. The earlier transient push failures were resolved before deployment.
2. Pages: run341 / `41828988079` succeeded with scope `sales-selection-layout-only`; all 101 public resource hashes matched. Only Sales `index.html` changed. Temporary branch permission was immediately removed and the original seven rules verified.
3. Wix: Sales page's single version-token draft was re-read exactly before publication; Studio confirmed published and live. No backend edits in this release.
4. Public: fresh existing user Sales tab loaded `20261104-sales-selection-layout-v1` in both iframe URL and actual build marker. Six real customer rows had ten matching cells, plain Selection text with transparent background and zero border radius, empty zero RFQ/Risk cells and preserved positive Risk alerts. No captured errors. The original refreshed tab became unavailable; a newly opened user tab was found and verified. This does not establish a fix for intermittent Wix loading.

All four release stages passed. Ready for the user's testing; not merged into main or frozen as a new user-confirmed baseline. Existing verified Excel downloads and the two submitted test orders remain untouched. Private exact source/readback, release receipts and screenshots are retained under the root handoff directory of the same task name. Risk/QD scope alignment remains an explicit separate backlog item.
