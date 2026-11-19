# Staff workspace authorization — candidate, not released

## Approved objective

Staff Management is the authority for workspace entry and customer work. Page access, product selection, quote publication and transaction attribution are different permissions. A caller must be authenticated and the backend must read current permissions on every operation; a previously opened page is not a grant.

Law's additional rule: explicit Sales Performance permission includes Quotations. Quote-only permission does not include performance. Current quotation ownership follows the authoritative customer `assignedStaffId`; historical performance/commission follows original transaction ownership. Never infer historical ownership from a current owner or submitter.

## Named acceptance cases (fake identities in automated tests)

| Person | Customer work | Quotation scope | Transactions |
| --- | --- | --- | --- |
| Super Admin | All | All | Existing admin rules |
| LIM, YEOYO | Staff Management customer grants; Catalogue selection | Own assigned customers | Existing explicitly enabled actions |
| RINN | Staff Management customer grants; Catalogue selection | None | Existing explicitly enabled actions |
| KAVI | Temporary all-customer profile entry and selection | None | No creation, request, review-quantity or NCT/GHR submission |
| SAM, HIA | None | None | Warehouse/company tasks only; no customer grants required |

These cases are test inputs, not evidence that real staff records have been changed. Do not activate pending employees or bind identities on their behalf. The old generic Sales Management View field is not automatically a new performance grant, particularly for RINN. New explicit fields take priority; cached forms cannot overwrite them.

## Candidate implementation

- Explicit customer-work group with scope, creation, profile editing, Catalogue and Buyer Room levels, and order submission.
- Separate quotation and performance fields with one-way implication in UI and server policy.
- All-customer browsing uses action-scoped grants, never the Super Admin boolean. Lifecycle/FX/admin checks remain admin-only.
- Quotations no longer borrow Sales Room entry permission or Support service grants. Every quote action checks authoritative current ownership.
- LTPOS Sales Room links use the existing staff sign-in route, resuming an already authenticated FMCG session. OAuth state checks remain mandatory; return routes are same-site and expire.
- Sales Entry rereads staff permissions; Catalogue-only staff can enter the Catalogue without Buyer Room permission.
- Restricted/expired staff pages give a staff-specific error or staff sign-in, rather than sending staff to customer Google sign-in.
- Existing save no-op guards, request-specific receipts, protected prices, order snapshots, downloads and formulas are retained.

## Recovery and release boundary

Base record `11737514`, current Pages run `44487494544`, Staff runtime `8be229a7`, build `20261119-staff-custom-domain-v1`. Existing user-verified entry tags remain unchanged. Exact live-source captures are private under `handoff/staff-workspace-permissions-20261119/live`.

The proposed isolated static package contains 117 resources: only Staff Management and Sales Room shell change; 115 remain identical. No live permission records, Pages deployment policies or production business data have been written for this candidate. Original seven deployment policies remain unchanged. No main merge or new verified tag. Thirty minimal Wix draft patches (20 MASTER and 10 FMCG) have exact editor readbacks; neither site has been published.

## Formal department dependency and approved source choice

Fresh formal Support and Warehouse reads still used legacy department lists for some workroom entry. Support's formal source includes payment-term functionality absent from this checkout (formal normalized SHA256 `7f0a90732ba76d76e43ce4d1b1c31a185497725d87cfb774905a1fbeb80c27fe`, repository `f4db98cee9a336120a2a0b63ce252acc9b35459ac3cb00d391e21f1c6d2a249e`). `packingListContext.js` is identical after newline normalization. Law explicitly approved: “沿用正式原件，只补权限检查（建议）”. The formal originals are preserved in the prototype `formal` directory. Minimal permission adapters now cover Support, Warehouse, Finance, packing, fulfilment, stock and department messages. Purchase's existing managed gateway is retained. No whole-file synchronization, live permission rewrite or Wix publication has occurred.

`prepare-departments.cjs` preserves formal payment terms, shared Activity reads, Desk actions, receiving error classification and all six request-specific receipt readers. Baseline-preservation tests compare these to captured formal sources. A Stock Control resource marker initially differed in the repository; the candidate now keeps formal `20261117-stock-contextual-retry-v1` exactly, changing only its separate workspace permission adapter.

Formal Sales Management currently connects Quotations only. This authorization task does not invent a new Sales Performance business page or claim that one is live.

## Verification evidence and limits

The final affected run passed 150/150 tests. Fake-data tests cover one-way implication, own-customer quote filtering, all-customer KAVI without admin/trading, SAM/HIA without customer pages, stale-page revocation through the actual MASTER → FMCG bridge and Catalogue/Buyer resolvers, expired/foreign return targets, preserved OAuth state, first-login assignment eligibility, no-op Save and save receipts. Desktop and 390px Staff UI tests passed. Current quote grid/1000-row resize, 50×500 cost references and native Buyer Excel path passed affected checks.

The initial Support regression fixture exposed the legacy workroom dependency. After the approved permission patch and injection of the formal payment-term callback, all 11 department permission checks passed. The loopback persistent-quote test passed once run with local network access; its first restricted run could not deliver to the local fake receiver. Keep these conditions distinct from production defects.

Wix Run reached the Developer Console for MASTER Stock Control and FMCG Sales Room Login without a visible compilation failure. Preview is not a live authenticated test: Stock Control requested sign-in and the preview member was not authorized for Sales Room. No Google sign-in or actual staff grant was attempted. Historical editor network/save errors were retained as diagnostics; exact editor readback alone is not proof of cloud publication.

Required before release: obtain exact one-use deployment authorization for the completed commit, verify the static build, restore/compare all seven policies, publish both sites and verify public entry and staff configuration. Real KAVI testing on her own computer remains separate from synthetic acceptance. New live employee grants need a private recovery capture and concrete action-time confirmation; no pending employee may be silently activated or impersonated.
