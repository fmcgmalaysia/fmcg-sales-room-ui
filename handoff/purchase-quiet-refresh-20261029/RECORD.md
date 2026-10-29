# Purchase background refresh notice

Objective: stop the repeated Updating records banner from shifting the Purchase lists while preserving background reads, first-load feedback, errors and all save/stock behavior.

Startup framework: root AGENTS.md and START_HERE.md, checkout supplement, WORK_EFFICIENCY, SYSTEM_OWNERSHIP/RECORD and the current allocation RELEASE.md were read. Historical START_HERE descriptions were separated from current evidence. Some oversized combined output was truncated; bounded relevant ranges were read again. A mistaken checkout-relative START_HERE lookup was corrected to the actual root. Protected verified tags for row-drag-save, requested split and stop-waiting remain unchanged.

Current recovery: code3950339, recordbe3674a, build20261029-customer-allocation-v1; all94original static resources remain preserved. Fresh live index/app/style bytes match that package. Fresh Wix Purchase source matches the repository and is preserved privately. An early clipboard copy still contained the previously selected module while Wix switched editors; component identity was checked and the actual Purchase page copied before proceeding. No live conflict or overwrite occurred.

Cause: the existing10-second workspace refresh reads the current P.O. state. loadPurchaseOrders sets poLoading and render prepends an in-flow po-read-status even when poData already contains usable rows. Removing it on completion moves the whole list back up. This is a read, not a repeated save.

Minimal patch: one render condition now requires !poData. Existing-data refreshes remain silent. First load retains Loading records; errors, request payloads, timers, draft/edit guards, retry identities, allocation and Loaded authority are unchanged. Shared render consumers: Purchase Order, Purchase History, Payment Follow-up and Activity History. No backend or other department source changed. Wix changes only its Purchase version token.

Browser evidence: the actual94-resource package, with real Purchase projection fixture and delayed P.O. responses, ran two natural10-second refresh cycles. The untouched released app reproduced37px movement of both heading and table. Candidate movement was0px, no Updating records samples, with three workspace and three P.O. reads and updated amounts received. Other three list views retained their headings and no background notice. No client errors, external requests or production writes.

Existing regression:130tests,127pass,3fail. Two UI failures (retired arbitrary allocation editor and old staff suffix) were reproduced with the untouched parent app. The third is an obsolete save-continuity package hash check against an older Support version; its actual Support source is identical to the parent and not touched by this patch. No new failure identified; stale assertions were not rewritten to manufacture a pass. Full logs remain private.

Release preparation changes only app.js and the Purchase index among94public resources; the other92hashes are pinned and checked. No backend or private evidence is uploaded. One scoped workflow option is added for that package. Code/GitHub/Pages/Wix/public stages are pending until recorded below. Main remains unchanged and user acceptance is pending.

## Publication and public verification completed

- Code:0b61b6e878f64241b0d88142de2bec272ae55d40, build20261029-purchase-quiet-refresh-v1, draft PR238. This continuation made no runtime code or permission changes.
- Pages:workflow40903779344 completed successfully. All94public resource hashes matched; the original nine retired paths remain404. Temporary policy64808400 was removed and the original seven deployment rules restored exactly.
- Wix:the single Purchase entry version replacement was fully read back against the repository. Wix confirmed “This site is published and live online.” Source recovery copies, exact before/after files and publication screenshot are private in the root task handoff.
- Public:new formal page51428379 was opened through the original Chrome shortcut and hard refreshed with native Ctrl+Shift+R. Employee LAW and all three real Purchase orders loaded using the new embedded build. Thirty-one read-only DOM samples over30.811seconds measured0px heading movement,0px table movement and0loading-notice samples; the three rows remained visible. Payment Follow-up, Purchase History and Activity History opened with their correct headings, no update notice and no visible error. No relevant console errors were captured, and no production business transaction was submitted.

The earlier Windows URL-confirmation safety stop was respected. On the user's explicit continuation, fresh browser inventory identified the completed native-opened tab. The browser API reload again produced the previously observed blank embed. Normal Chrome shortcut navigation and native hard refresh succeeded without settings, login or business-code changes. This does not claim to resolve that separate automation/Wix interoperability issue.

The verified formal Purchase Order page is left open for the user. User acceptance remains pending; do not merge into main or create a new user-verified baseline tag yet.
