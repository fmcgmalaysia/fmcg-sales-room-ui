# Quotation date, immediate switch, Order Form sort and portal mark

Scope requested by Law on 19 November 2026: correct Buyer Room Last Quoted; turn the View Quote switch on immediately during publishing and revert on failure; make Order Form follow My Selection's Sort ID order; show the approved LTP mark beside the signed-in portal title. Catalogue optimization remains paused. This is a candidate, not a completed publication.

## Verified originals and minimum changes

- Recovery is 0877a98d / Pages run 44453020525. Law confirmed desktop Catalogue/Buyer navigation and the annotated desktop checkpoint records that scope only. Do not extend it to Safari or idle sessions.
- Fresh formal FMCG masterWebQuotationData.js is 7566/5830ce18 (normalized length/FNV), identical to the repository original. It returned WEB-1/WEB-3 as quoteEffectiveAt. Date parsing reproduced 01-01-01/01-03-01. The patch preserves that existing version/cache key and adds quotePublishedAt from the immutable quotation record's _createdDate. Reads and retries do not create or update CMS records. Unknown dates remain empty; quote visibility, currency, price, selection epoch and ownership gates are unchanged.
- Buyer Room uses quotePublishedAt for Last Quoted, rejects WEB version tokens as dates and retains browser-local time rendering. Order Form reuses the already-live byPointBaseSortId comparator after its existing search/quantity filtering. No quantity writer or submission code changes.
- Quotations alters only the visual switch indication during the existing row-scoped publication. A transient map records the intended state while publishing/confirming. Confirmed counters and dates remain authoritative. The same row stays protected against double submission; other rows remain editable. Explicit rejection restores its previous state, and uncertain/pending attempts retain the existing request and confirmation path. A completed fresh read takes precedence over a transient indication.
- The portal reuses the approved LTP mark and the previous independent 864153a0 layout, referencing the existing Wix asset instead of adding another image. The previously prepared portal branch was never deployed. Native workspace links, login/logout and staff grants are unchanged. Fresh portal page is 2877/3dedb0da; fresh Buyer page is 16497/ea89c310. Only their frame version strings need updating. Public Quotations embed is 60364/4e9dcc08, exactly matching the preserved Wix readback; replace only app hunks and build marker.

## Validation

- 14 focused Node checks pass: real receipt timestamp/unchanged cache key/no read writes, rejection of malformed dates, legacy behavior, buyer access, selections, Excel, order snapshots, quote notifications and portal parent/origin authorization.
- 21 additional quotation checks pass, including six carton-only costs, Last SP, scheduled cost preservation, drafts, permissions, idempotency, existing locked prices, Excel and 1,000-row resize. The local HTTP recovery test initially failed identically on the unmodified baseline under restricted loopback; it passed all four cases with local-network access. No business change was made for that environment restriction.
- Responsive fake-data browser checks pass at 320/390/1440 in Asia/Kuala_Lumpur and Europe/London: actual date conversion, matching Order Form/My Selection ordering, search/quantity filters and retained quantities. Portal checks at 320/390/768/1440 show the loaded mark without horizontal overflow.
- 1,000-row switch fixture with a 5.5-second receipt passes immediate blue indication, concurrent publication, unrelated draft/focus retention, pending original-request confirmation, withdrawal, single-row failure rollback and no grid removal. Screenshots remain in the local task handoff, not production acceptance.

## Exact release boundary

Stage from the verified 117-resource Pages archive at run 44453020525. Only buyer-room.html, master-quotations/app.js, master-quotations/index.html and ltpos/managed.html change; the other 113 remain byte-identical, including all Catalogue and department assets. Staging asserts the four original SHA-256s. Use only the dedicated quotation-buyer-followup-only workflow input. No environment rule has been modified for this candidate.

Expected published hashes:

- buyer-room.html: f2c98d7f3ee11ad9a5c978cbc489db40e0cee7c25e63b77d500c7daf9f854bb1
- master-quotations/app.js: fc574f4adf377eff3f71bdb7386646dc1b0974c725474da1fab4dc256992e9b6
- master-quotations/index.html: 304142da81c6b134de68f6b7c74a31271012b65d788b5fbad6f675e20c0f784d
- ltpos/managed.html: 0972ee9aa8e157977c34085d9fc357ec692aae652ad87eccf69ccc859825cb50

Publication still requires exact scoped deployment permission, immediate restoration of the original seven policies, fresh Wix readback/minimal synchronization, new published/live receipts on both sites and public acceptance. Do not re-publish AVATA prices merely to correct a display date. Use its existing quotation timestamps read-only for date verification; publication/failure writes remain isolated unless Law explicitly authorizes a real row test.
