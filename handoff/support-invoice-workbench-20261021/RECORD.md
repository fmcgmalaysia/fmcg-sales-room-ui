# Support invoice workbench draft — 2026-10-21 MYT

## Current user decision — page only, real invoicing deferred

User answered the pending questions: finish the Support page first and do NOT enable real invoicing. Shipment/container grouping and invoice integration are deferred, not blockers for the UI-only draft. Preserve the accepted typography, exact Loaded display, compact layout and explicit non-operational preview; no invoice issue, business Save or CMS writes are authorized in this phase.

User identified net weight in POINTBASE column U, sheet gid1666933373: https://docs.google.com/spreadsheets/d/12tyTIrmjF6JxMY-JW8K3JLuz5TcCkEjQUFXsauberLg/edit?gid=1666933373#gid=1666933373 . This is a user-reported source, NOT a verified mapping. Header, unit, product join key and per-piece/per-carton basis remain unverified. Do not estimate from packaging or treat missing weight as zero. Inspect only the necessary header/sample ranges before future real-data wiring; do not scan the full catalogue for this UI phase.

## Compact layout continuation — still an isolated candidate

User asked to optimize pages before publishing and explicitly preserve this draft's font. Added draft-compact.css, loaded after the original stylesheet, for49px desktop header,44px nav, tighter spacing, same-size bilingual main title and680px invoice dialog. Removed the separate stock-preview navigation from Support because Warehouse owns Stock Control. No original draft.css edit: raw SHA256 remains3C329A5A65FD86A2B0CC60FB010884BD401F9160DA2BC8FBF6E931A1086D4E95. No font-family/face override is present in compact CSS. Two typography/scope tests plus original12 domain tests all pass.

This is source/offline verification, NOT visual acceptance. Browser URL policy rejected observation of the already-open local file; do not work around that gate by raw browser/native control or by mirroring the same blocked Support page into another browser surface. User may inspect the local file themselves. Real data, batch invoice coverage, verified net weight, journal-integrated Save and loading-after-invoice locks remain unfinished and are explicitly deferred by the current user decision above. Do not publish fixture data or claim invoice integration complete. No Wix or Pages changes from this Support continuation.

## User-verified typography checkpoint — 2026-10-21

User inspected the local draft and explicitly requested preserving its excellent font. This verifies typography only, NOT invoice behavior or production readiness. Exact code checkpoint cb7b358; draft.css SHA256 (raw bytes) 3C329A5A65FD86A2B0CC60FB010884BD401F9160DA2BC8FBF6E931A1086D4E95. Preserve the Support Inter font-face source, variable weights100–900, fallback stack 'Support Inter','Segoe UI','Microsoft YaHei',Arial,sans-serif and inherited control typography. Current body11px/1.35 is the accepted compact reference. Do not replace it with a new department theme/font while integrating the workbench. Annotated verified/support-draft-font-20261021 records this narrow acceptance. No production code or functionality is frozen by that font-only tag.

## User clarification — exact Loaded, no subtraction

The user explicitly clarified that Loaded is the quantity physically inside the container and Support must invoice exactly that quantity. The initial draft's subtraction/partial-invoice policy was an assistant assumption and is withdrawn. The candidate now sets invoiceQty directly to the container delivery row's confirmed Loaded. Any issued or pending invoice locks that row; changing Loaded away from the invoice snapshot requires supervised correction, never automatic delta invoicing. The main table has one Loaded Qty column rather than Loaded/Invoiced/remainder columns. CBM, net weight and amount use the full Loaded quantity. Twelve revised offline checks and script syntax checks pass. This changes only the isolated draft; no production invoice or Warehouse handler was changed.

## Current scope and recovery

The user authorized preparing Support while unavailable Wix operations are blocked, and requested a Purchase-style task list, checkbox merging into an invoice, CBM and net weight, and shipment quantities based on Warehouse Loaded. This is a separate design-draft branch `feat/support-invoice-workbench-20261021`, based on Stock Card record `2d0a15d`. PR215's committed work remains intact. Existing protected runtime c9bd6d6 / Purchase entry split-controls-v2 and all production Support files are untouched; original split verified tag remains present. No whole-system rollback is intended.

No existing production file changed. New candidate files are `support-room/draft.html`, `draft.css`, `draft-app.js`, `invoice-draft-model.js`, plus offline tests and this record. The draft is self-contained apart from relative scripts/styles and an optional font. It opens as a local file without a preview server. All quantities, names, prices, dimensions and invoice examples are synthetic and explicitly labelled. It cannot save, issue, dispatch, chat, generate an official PDF, or write CMS/local storage. Real `support-room/index.html`, `app.js`, `style.css`, and Wix/backend remain unchanged.

## Current-system evidence

- Existing Support app lists REQUESTED shipments, then records an invoice via FULFILMENT_SAVE_REQUEST / INVOICE. Existing `customerFulfilment.js` invoices the selected shipment lines; it does not compare their quantity with Warehouse Loaded. It freezes invoice pricing/FX/source costs, then requires an INVOICED shipment for DISPATCH. Those protections must survive future integration.
- Warehouse preparation records per-delivery/batch `id`, taskId, loaded, signature, revision/version and stale/orphan status. Its LOAD handler limits quantities to allocation and requires a reason for reduction/partial load. Loading is not actual stock dispatch.
- `customerShipmentLedger.js` currently requires distinct taskIds inside a shipment. Two independent delivery batches can still share one original taskId, so merging those display rows into one real invoice needs an explicit batch coverage mapping. Do not simply send duplicate taskIds or manufacture a second receipt. Invoice/dispatch snapshots must remain stable.
- Current fulfilment read output does not expose preparation version, delivery batch invoice coverage, CBM or net weight. Purchase projection has cbmPerCtn but no netWeightKgPerCtn. A targeted weight-field search of the inspected business modules found no usable mapping. This is a known interface gap, not proof the original product source has no weight data. Never infer net weight from pack labels, litres, carton weight or selling price.
- Existing preparation LOAD handler blocks correction after dispatch, but the inspected handler has no invoice-coverage check. The future Loaded-based invoice release must add the appropriate protection so corrections cannot reduce loading below issued/pending invoice coverage. This draft does not modify that behavior.

## Candidate rules

One row represents an independent Warehouse delivery batch, not a supplier purchase source. Checkbox selection creates one invoice draft only for matching company, customer, invoice party, currency and shipment group. Different order lines and duplicate products may remain independent lines under one invoice. The first selection establishes context; incompatible rows are disabled, select-all selects compatible visible rows, filtering retains selections, and company switching asks before clearing them.

Invoice quantity = the confirmed Loaded quantity physically inside this container, for the exact delivery row. REQUESTED/RCV/planned demand is never substituted. Unloaded, unconfirmed, stale/orphaned, malformed, issued or pending rows are not selectable. Any difference between Loaded and an existing invoice snapshot is review-required, including both increases and decreases. Loading and invoice-state versions are captured at selection and rechecked when building a draft. This is offline validation only: real concurrency must use the existing server operation journal and fresh authenticated state.

CBM and net weight are calculated from Loaded and verified per-carton dimensions; amounts use integer cents, CBM integer millionths, net weight integer grams. Missing dimensions/prices stay unknown and block the complete invoice preview. They never become zero in a total. Printed draft quantities are read-only; changes belong to Warehouse. Once the container loading row is invoiced, subsequent quantity changes require invoice correction. They do not create an automatic additional invoice for the difference.

UI: compact Purchase-style blue-grey task table, independent row numbers, Since/customer/product, Loaded Qty, price/amount, CBM/Net Weight, passive pale states and blue real preview actions. Top filters and three action cards, sticky selected totals, a compact bilingual invoice dialog, read-only invoice preview/history, Sales/Warehouse contextual chat-entry concepts. Invoice issue submission and actual chat sending remain absent. No Account chat or unnecessary repeated activity is added.

## Validation and limitations

12 offline domain checks cover exact Loaded, separate rows sharing a source, status/quantity rejection, issued-row locking and changed-loading review, merge incompatibilities, missing dimensions, changed versions, duplicate identities, missing invoice-state version, whole-row pending lock, legacy partial invoice review, and unchanged inputs. Script syntax and staged whitespace checks pass. No new production tests are needed for this isolated draft because no production consumer imports it. No visual browser pass is claimed without actual observation.

UI access limits: user refreshed Wix and explicitly permitted necessary screen use while asleep, new-tab recovery, and stopping after two failures. First refreshed-state capture timed out; a new tab could be created, but selecting the existing Master tab returned geometry unavailable. Following the user's subsequent refresh, input was stopped by the helper's user-input guard; the required state capture timed out again. Browser interaction then stopped. No field was typed, no editor was changed, no publish occurred, and no unsaved form was refreshed. Do not repeatedly wake the user or claim refreshing fixed the automation connection.

## Next concrete integration work

1. Obtain complete fresh Master source readback and compare with the preserved repo before touching production files.
2. Resolve Stock Card own-source versus explicit allocation and physical isolation/removal gaps; PR215 remains candidate only.
3. Establish one authenticated Support projection joining delivery batches and invoice coverage; no browser-only authorization or synthetic missing batch identities.
4. Map verified CBM/net weight with explicit units and preserve invoice dimension snapshots. Confirm invoice party/shipment grouping from actual business identifiers.
5. Make invoice creation reserve the exact loaded batch quantities under the shared company journal; reject stale selection, duplicated invoice numbers, repeated request over-allocation, and incompatible groups. Preserve cost/FX snapshots, downstream debtor accounting, and source allocation/dispatch history. Keep same-request retry after partial cache update.
6. Prevent incompatible loading changes once invoiced/pending, or route them through supervised invoice correction. Support must not post physical stock deduction; only actual dispatch does that.
7. Decide the smallest compatibility patch for merging delivery batches under the current unique-task shipment ledger; do not replace that protected ledger wholesale.
8. Then connect the UI, regress protected Sales/Purchase/Warehouse/Account consumers, obtain actual user invoice acceptance, and complete four-stage publishing. No Pages branch permission for this Support branch is currently granted; the older precise permissions do not transfer.

## Release status

Code: isolated Support draft 29a4a22f1021511267171a705e28e952339733a9. GitHub push succeeded and draft PR216 was created and read back open/unmerged against the Stock Card candidate branch: https://github.com/fmcgmalaysia/fmcg-sales-room-ui/pull/216 . PR216 is attached to the chat. Eleven offline checks and both script syntax checks passed. The local file browser open was queued by Codex, which is not evidence of successful rendering or visual acceptance. Pages: not deployed. Wix: unchanged. Public Support: existing version unchanged; the new draft has no public verification. Actual task Credit usage UNKNOWN.
