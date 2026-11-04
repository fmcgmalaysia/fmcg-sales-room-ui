# Selection Excel image links

Current task: make existing A-column image URLs clickable native external hyperlinks. Follow-up explicitly requested: F header `{customer currency} / EA`, G header `{customer currency} / CTN`; preserve all price inputs and the existing G=E*F formula.

Previous work closed first: quantity runtime76f63ae, record6d30665, PR338; all four release stages complete, original seven deployment rules restored. User confirmed native My Selection Excel download. Recovery tag verified/buyer-selection-excel-20261104 is scoped to that download, not Buyer historical PDF/back.

Fresh Wix generator differs only by an EOF newline; download module differs only by blank lines. No business token difference. Exact copies/hashes retained locally, preserve live formatting when applying isolated replacements. Two backend modules only. Shared generator also owns Order Received export: its whole output must remain byte-identical.

Reuse the existing native XLSX hyperlink relationship mechanism used by Open Buyer Room. No macros, no new library, no download mechanism replacement, no sharing/authentication change. Preserve original URL display and existing hyperlink style. Only web URLs become links; blank/invalid/non-web data remain plain text. Browser tab placement is controlled by Excel/default browser, not XLSX.

Include an export-format marker in the existing content hash so the old plain-URL file is not reused after format changes. Keep the same file service, content-based reuse and existing expiry/cleanup. This is a format invalidation, not a new export/storage authority.

Acceptance: URL text/target and XML escaping, multiple/blank/invalid links, unique row relationships, existing Buyer Room link, formulas/barcodes/numeric values and frozen/filter/print settings, unchanged Order Received workbook; then F/G USD+SGD labels with unchanged values/formula. Publish only after fresh draft readbacks. Pages resources should remain unchanged for this backend-only patch. Actual new Excel download and image hyperlink opening must be checked before calling complete.
