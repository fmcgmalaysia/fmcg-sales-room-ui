# Sales Management web quotation — isolated candidate

2026-11-17. User-approved scope: a new MASTER Quotations workflow, manual Catch Cost, Target GP and selling-price calculation, row publication switches, then a fictional customer through Catalogue selection, Buyer Room Excel and ordering. Daily cost refresh is deferred. Old QD remains the rollback system. No production customers or production systems were changed.

## Scope and recovery

Branch: `feat/master-web-quotations-isolated-20261117`.
Repository reference: `728b1ab3`; this is a local source reference, **not a claim that current live Wix matches it**.
All changes are additions in this directory. Existing source files, other candidates and deployment rules are untouched. Removing/ignoring this prototype returns to the original local checkout. Production has nothing to roll back from this work.

This is a loopback-only fake-data application. It is not deployable production code. In particular, the QA identity selector and customer selector simulate authenticated contexts; they are not a login or secure multi-tenant transport. Do not expose the server on a public interface or deploy its API.

## Run

From the checkout root:

```text
node integration/prototypes/web-quotations/server.cjs
```

Open `http://127.0.0.1:8896/#catalogue` on this computer. Select fictional products, open Quotations, Catch Cost, enter GP or price, turn on Customer Quote, then open Buyer Room to download Excel or request an order. The dropdown can simulate the other company/customer and a read-only employee.

Local state persists to `.qa-state.json`, excluded from Git. Only fictional customer names, costs, prices and orders belong in this preview. Local browser drafts are also saved locally. No Google or real CMS calls are made.

## Design and implementation

- Internal identity is customer ID plus selection ID, with barcode as product lookup; no Sheets file IDs, row numbers, QD creation or VERIFY stage.
- Catch Cost reads the customer's entire current selection independent of UI filtering and deduplicates barcodes. Missing costs retain the last successful cost with an error. In-flight publications are skipped until confirmed.
- Cost input is MYR per carton. FX is MYR per customer currency unit. Target GP means gross margin on selling revenue, using the existing `grossProfitMargin.js` contract. Unit price = carton MYR cost / (1 − GP) / FX / units per carton. Direct price editing calculates actual GP.
- Candidate prices use six-decimal unit prices, then carton price = rounded unit price × packing quantity. This keeps the existing Excel carton formula consistent. Real business rounding/FX must still be verified against authoritative live rules before integration.
- Cost refresh changes internal costs, actual margin and Target-GP draft suggestions; it does not automatically change customer prices. Visible rows have a separate Update quote action. Turning off removes purchasable prices but retains selection and already submitted order snapshots.
- Draft edits and published snapshots are separate. No-change and change-back UI Save states are disabled. A pending publication retains its immutable request ID/payload and is recovered by the server. Stale revisions and request-ID content conflicts are rejected.
- Quote off does not save an unfinished draft; the local input remains available. Read-only actors cannot edit, catch or publish.
- Publication payload uses an explicit allowlist containing only customer/selection identity, barcode, currency, prices and receipt/version metadata. Cost, GP and commission never enter that payload.
- Existing policy functions check MASTER department, company, customer and action access. The prototype supplies fictional identities; actual staff authentication and authoritative ownership must be verified during live-source review.

## Reused components and deliberate substitutes

`isolation.cjs` loads these repository components without editing their files:

- `integration/backend/staffManagementPolicy.js`
- `integration/backend/grossProfitMargin.js`
- `backend/catalogueSelection.web.js`
- `backend/catalogueAuth.web.js`
- `backend/buyerSelectionDownload.js`
- `backend/buyerSelectionExcel.js`

Catalogue source receives three guarded, in-memory substitutions: an explicit WEB customer bypass of the legacy QD-ready gate; WEB mode in the resolved context; and preservation of an active WEB selection/quote on repeat selection. Without the last change, the original function resets an already published quote to RFQ when selected again. No production source is patched.

Buyer workspace, order submission and Excel-building functions execute against a fake Wix store. Point Base is a fixed-cost fixture. The publisher is a simulated server-to-server receiver. One local atomic file checkpoint models a receiver item/receipt commit; it does **not** prove atomicity or concurrency guarantees in Wix CMS across two sites. The local serial queue is not a distributed lock. Real integration must resolve those exact boundaries before rollout.

The Catalogue and Buyer tabs are minimal QA surfaces using those functions, not the full production layouts, navigation, Google login or CMS bridges. Production Sales Room receipt/progress is not tested by this preview.

## Verified tests

`node --test integration/prototypes/web-quotations/quotation.test.cjs`: 10 passed, 0 failed.

Coverage: repeated selection retains quote; Target GP/unit/carton arithmetic including negative GP and invalid inputs; complete-list and partial-failure cost refresh; stable published prices after cost change; duplicate requests and stale revisions; disconnect before and after receiver commit with process-restart recovery; quote withdrawal and locked order prices; real Excel builder output; company/customer/Support permission refusals.

`node integration/prototypes/web-quotations/browser.test.cjs`: passed with no browser page errors.

Coverage: three selections → Catch Cost → GP25 → quote; 320/390/768/1024/1440 px with matching viewport and document width; 16px mobile inputs and menu open/close; price update to USD18/carton → actual Excel download → 2 cartons ordered at USD36; other customer isolation; incomplete draft retained during withdrawal and lost-response recovery; Save disabled after save/change-back; read-only controls disabled.

The first browser attempt could not access loopback under the restricted execution context. The approved local-browser run passed. An added edge-case test initially expected an empty-priced withdrawn quote's switch to become enabled; that expectation was corrected to disabled, then the complete browser test passed. This was a test expectation error, not a production incident.

Evidence is in `handoff/catalogue-and-mobile-20261117/sequential-release-preflight/web-quotations-evidence/` in the workspace root: five quotation screenshots, Buyer order screenshot, the downloaded XLSX, browser result JSON and source hashes.

## Next sequence and publication status

1. Review this local candidate's workflow and pricing semantics. Preserve this checkpoint.
2. Read current live MASTER Sales Management and relevant FMCG selection/customer/order sources; capture hashes and protected recovery points. Resolve actual live/repository conflicts under the existing rule. Do not overwrite from this prototype.
3. In independent Wix testing only, attach fake customer identities, restricted Point Base test data and durable publication receipts. Verify real authentication, company/customer ownership, retry ordering, current FX/packing rules and cost privacy. Complete Sales Room receipt/progress and export regression.
4. Only after those pass prepare the minimum production patch, separately through the normal release gates. Keep formal customer data empty and old QD available until rollout acceptance.
5. Resume pending Catalogue/Buyer publication candidates; daily automated cost refresh is later.

Four release stages: code is a local isolated candidate; GitHub Pages not deployed; Wix not synchronized or published; public-page acceptance not performed. No claim of production readiness or publication.
