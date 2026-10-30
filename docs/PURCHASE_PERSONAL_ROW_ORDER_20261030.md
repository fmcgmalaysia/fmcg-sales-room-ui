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
