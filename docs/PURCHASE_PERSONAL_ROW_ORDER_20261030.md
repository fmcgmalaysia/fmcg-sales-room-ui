# Purchase personal row order — background implementation

## Scope and authority

The user explicitly requested background changes to MOVE ROW. Row movement is a personal workspace preference, not a procurement transaction. This task does not publish, use Chrome, change deployment permissions, modify CMS records, or merge into main.

Branch: `fix/purchase-personal-row-order-20261030`.
Production recovery package and parent: `d7409c76a90b256601506e0068c78a917a7c694e`, build `20261030-docs-synced-colors-v1`.
Existing annotated verified recovery: `verified/stop-waiting-cn-20261026`. The earlier `verified/purchase-row-drag-save-20261016` behavior is superseded only for the new personal movement behavior explicitly requested by the user.

Fresh public `purchase-live/app.js`, `display-rows.js`, and `index.html` exactly matched the current assembled production package before editing. The assembled client includes previously released patches absent from the older raw client; the new packager applies only the same isolated row-order edits on top of that assembled baseline. It does not replace the deployed client with the raw source.

Before hashes:

| Resource | SHA-256 |
| --- | --- |
| app.js | `7794aab4eda637bdf76a1147c21e0a04e5a4ed7ec3badc20a576bcc13ebf2276` |
| display-rows.js | `b84c3c4f03ac9fa4989e6e900825554b7a951db0f66b396576353560d699d67d` |
| index.html | `4a5e3ae389c3effbd9ae661aca8be8b0a053ba4184c73433ab67c6952328a3a0` |

## Resulting behavior

- Native dragging and the destination dialog both use one personal ordering function. A move takes effect immediately, without Save, a new save request, a business history entry, a CMS write, or a task edit-version change.
- Only row identities are stored. The latest preference replaces the previous preference; no sequence of movement events is appended. Prices, quantities, money and business documents are not stored in this preference.
- Preferences are isolated by company, verified employee and member identity, then by customer. They are remembered in the current browser; there is no cross-device synchronization.
- Supplier source children follow their parent. Split shipment rows retain their separate identities. Deleted and archived rows disappear from the displayed preference; new rows and newly split identities reconcile with the current workspace.
- Moving within a supplier-filtered view preserves the other customer rows in the ordering input. Dropping onto a different customer's row is rejected. Independent customer arrangements do not block each other.
- Storage errors keep the order in memory for the current page and do not block work or demand a business Save. Permanent browser persistence is unavailable in that condition.
- Real price drafts, supplier allocation drafts, payment restrictions and business save recovery remain in their existing flows.

## Existing drafts and single-path boundary

An old unsent row-order draft is converted to the personal preference and removed only from the ordering portion of the session draft. Real price and supplier drafts are retained.

An old already-submitted request with an unknown result must retain its exact request ID and payload. Receipt checks and retries still use that original request. This recovery can complete a pre-existing transaction; it cannot create a second new movement path. After a definite rejection, its unsent ordering becomes a personal preference, while its actual price edits remain available for a fresh business save.

New movement never sets the old sequence draft or includes task ordering in `saveEdits`. Backend ordering projection and historical journals remain unchanged because other workflows and existing recovery rely on them. No historical data is deleted in this task.

## Verification

| Check | Result |
| --- | --- |
| Personal preferences, identity isolation, split reconciliation, storage failures and tab merge | Passed |
| Current assembled production client with the minimal patch, movement and business-draft scenarios | 19 passed, 0 failed |
| Related regression suite including receipt recovery, original save reconciliation, PO paid locks, document policy and shared document colors | 84 passed, 0 failed |
| Full raw-client UI suite | 121 passed; 4 existing failures also reproduced with the unchanged parent client and tests |
| Package scope | 94 resources; exactly 3 Purchase resources changed, 91 byte-identical to the current production package |
| JavaScript parsing, release marker and scoped release guard | Passed |

The four pre-existing raw-client UI failures are named:

1. `separate sourcing and receiving bubbles open a case-specific bilingual decision without clearing financial risk`
2. `planner allocation editor sends the selected receipt and explicit customer quantities with a reason`
3. `purchase orders render persisted documents and readable history, with upload input instead of fixture controls`
4. `live page starts empty, requests real Master data and never seeds demo business records`

The unmodified baseline had 118 passes and these same four failures. No new failing assertion remains. Those unrelated failures are not claimed fixed by this task.

Private exact before files, manifests and test outputs are under `C:/FMCG-WIX-LOCAL/handoff/purchase-personal-row-order-20261030/`. They are not bundled into the public site.

## Release state and remaining acceptance

Candidate build: `20261030-purchase-personal-row-order-v1`.
The scoped manual release option is `purchase-personal-row-order-only`; preparing this option does not dispatch it or change deployment permission rules.

1. Code: complete and locally tested.
2. GitHub Pages: not deployed in this background task.
3. Wix Studio: not synchronized or published in this background task.
4. Formal page: not visually verified for this candidate.

Before a later release, recheck the current live baseline for intervening changes. Preserve the user's existing Purchase tab containing the old unsaved move; do not refresh, save or cancel it. After the usual Pages and Wix publication stages, use a fresh formal Purchase entry from `https://fmcg999.wixstudio.com/master` to verify dragging, re-opening, customer and supplier filters, genuine price Save and department isolation. User confirmation is still required before promotion to a verified main baseline.

## Release continuation — 2026-10-31

The user authorized Chrome use, publication and formal verification. A fresh read of all 94 public resources matches the recovery package exactly. The original Purchase tab with its unsaved movement remains untouched.

The current full Wix Purchase page matched `integration/wix/purchase-room-page.js` before editing. A one-token version change was saved as a Wix draft and its full readback exactly matches the expected patch. No backend, Finance, Warehouse, Support or FMCGMALAYSIA draft was edited. The correct MASTER editor identity is site `8a6752d7-e5bb-42cc-aca7-77346a8e97a6`, metaSite `f80870fd-a3d8-47c0-9917-1bfd9c16ea44`.

Before-page normalized SHA-256: `c18577ef141f1f1c169cb87836e56088c01ad3f77fd090a5f5f2ddfd0fdb3ad9`.
After-page normalized SHA-256: `cefcae9770320ec4b613143409a9ff4ad77445624f602e2bd12b5a5284a31447`.

At the pre-approval continuation checkpoint these release stages were pending. The completed outcome below supersedes that checkpoint. Prior test results remain applicable: no business code changed during this continuation.

## Completed release and formal acceptance — 2026-10-31

Released commit: `cbf572a1fef00087bf6a6b8ae781b730cc60f414`.
Build: `20261030-purchase-personal-row-order-v1`.
Draft PR: [248](https://github.com/fmcgmalaysia/fmcg-sales-room-ui/pull/248); no main merge or new user-verified tag.

The user approved one exact temporary branch permission and one `purchase-personal-row-order-only` deployment. [Run 41093032764](https://github.com/fmcgmalaysia/fmcg-sales-room-ui/actions/runs/41093032764), job `124191561972`, succeeded. Only the scoped personal-row-order prepare/upload steps ran; the generic site upload and other release modes were skipped. The temporary branch rule was immediately removed after success and the exact original seven rules were visibly restored.

All 94 resource contents were verified. 93 match the Windows candidate byte for byte. `display-rows.js` uses LF in the Linux deployment instead of the Windows candidate's 51 CRLF endings; its deployed bytes exactly match the approved Git blob and its normalized code exactly matches the tested candidate. There is no code-content difference. The 91 resources outside the three changed Purchase resources remain identical to the pre-release package.

Wix's final pre-publication full readback still exactly matched the one-token patch. Wix Studio then displayed `Congratulations This site is published and live online.` The receipt screenshot is retained privately.

Formal acceptance used LAW, NCT, TESTING 02 on the clean public Purchase URL. A normal native Chrome new-tab navigation rendered the real workspace with the correct iframe URL, build meta and app/display-row script tokens. The following were observed directly:

| Scenario | Formal result |
| --- | --- |
| Actual mouse drag of LABOUR above DETTOL | Immediate new order; no Save or Cancel move control appeared |
| Business values before and after movement | All eight rows' quantities, costs, P.O., received and Loaded cells unchanged |
| Fresh backend workspace/history read after moving | Same 62 records, with the entire displayed history content exactly matching the pre-release snapshot |
| Open a second native Chrome tab and enter TESTING 02 | Moved order restored automatically without Save |
| Click a handle, choose the top destination and apply | Same personal-order behavior; original test arrangement restored successfully |
| Fresh history read after restoring the test order | Still the exact original 62 records |
| Refresh Support's TESTING 02 workspace | Eight task rows, same order and business values |
| Refresh Warehouse's TESTING 02 Delivery Task | Eight task rows, same order and business values |
| Refresh Finance overview | Two records, same business values, payment state and order |
| Candidate formal page errors | No captured console errors |

Relative `Today`/`Yesterday` display labels were normalized only when comparing department snapshots; actual timestamps, quantities, values, identities and order were preserved in the comparison. No genuine price, payment, stock, allocation, received or Loaded save was submitted during this release test.

The original Purchase tab containing the user's old unsaved movement was not refreshed, saved or cancelled. The completed test page was left open with the test arrangement restored, ready for user testing. Its original unsaved old-version counterpart remains preserved separately.

The documented tooling-related load limitation remains: tool reload of a clean page produced the correct new iframe address but an `about:blank` inner document with no captured page error. Native Chrome `Ctrl+T`, typing the clean URL and navigating normally rendered the real workspace on both acceptance openings. This is a verified operating route, not a claimed root-cause fix of the existing intermittent blank-page behavior. No startup, authentication or embed architecture was changed to achieve acceptance.

Private evidence: `PUBLIC_ACCEPTANCE_20261031.json`, `PAGES_VERIFIED_20261031.json`, `RULES_RESTORED_20261031.json`, `DEPARTMENTS_AFTER_MOVE_20261031.json`, exact before/after sources, history snapshots and screenshots in the existing task evidence directory. Raw business snapshots and screenshots are excluded from GitHub and public deployment.

Final four-stage status: code complete; Pages verified; Wix published/live; requested formal movement, history and department checks passed. User real-world testing remains the next step before any verified-baseline promotion.
