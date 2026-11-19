# Catalogue first fifty products

The user requested an initial 50-product view while the remaining CMS catalogue continues loading. Recovery is the published Velo source at `8dda9304` and the verified Pages run `44432875460`. The current live page was freshly read as `43221/64d99e36` before editing. The static workspace remains unchanged at `20261119-catalogue-critical-load-v1`.

Only the Catalogue page's CMS read timing changes. A concurrent, bounded distinct-brand lookup retrieves complete leading brand groups. The existing brand/numeric Point Base Sort ID comparator orders their records and exposes the first 50. Equivalent raw brand spellings at the boundary are included together. Incomplete brand lists, groups exceeding a page, a catalogue exceeding the existing 10,000 cap, failed reads and superseded queries defer to the original full read. The full read shares its initial CMS request and remains authoritative.

Search, All Products and supplier filtering wait for the full cache when needed and discard superseded responses. Existing category queries remain independent. Selection permissions, optimistic feedback, receipts, customer context, quotes, downloads and orders are unchanged. No CMS write or deployment-policy change is involved.

Isolated checks exercise exact prefix ordering, numeric/equivalent/blank brands, delayed full reads, late preview, unavailable/oversized groups, search/category races and All Products. Existing paging, sorting, identity, image, Buyer entry, quote-read and publication checks also pass. At 320 and 390 px, merging the full list retained scroll offset 1699 px, anchor `fake-24`, a selected row and unique row identities. Cross-tab selection scenarios are recorded separately before publication.

This record initially describes a candidate. Wix synchronization, publication and real-page acceptance are separate release gates. Public timing must distinguish first products, full catalogue, identity and Wix startup; local tests do not establish iPhone Safari speed.
