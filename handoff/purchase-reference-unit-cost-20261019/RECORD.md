# Missing reference unit cost — 2026-10-19

Objective: A&W barcode9555589200293 Catch Cost is rejected. No UI redesign, intake change, source-price update, CMS write, quantity, authorization, lock or financial change.

Evidence: existing POINTBASE FOOD row754 read through native Sheets UI; ACTIVE, EA24, COST/PC blank, COST/CTN44.40, discounts0/0/0, NET44.40, CBM blank. Header and displayed row preserved privately. Original sheet selectionF655:F670 restored, no sheet edits. Actual Purchase error screenshot is generic Wix backend failure. Fresh Wix purchaseOperations.web.js10238chars matched repository before edit; private exact copy in C:/FMCG-WIX-LOCAL/handoff/purchase-reference-unit-cost-20261019/.

Reference gate permits missing-CBM-only snapshots only when all five price fields are finite. POINTBASE intentionally permits absent per-piece cost. The actual source shape reproduces POINTBASE reference is unavailable in the existing endpoint test before repair.

Minimum patch: inside getPurchaseReferenceCost only, copy the fetched snapshot and derive absent lpPc=lpCtn/eaPerCtn when carton cost is positive finite and EA positive integer. Original response snapshot not mutated; explicit per-piece cost authoritative; no rounding of internal precision. Existing identity/currency/time/status/cost-issue gate unchanged, including rejecting inactive products, missing carton cost and invalid EA. No other web method or transport changed. UI displays1.85 and44.40, from44.4/24, on success.

Recoveryb96d319 / runtime69e1ec7; limited annotated verified/department-ui-before-20261018 retains its prior scope. 38focused allocation/reference/retry tests pass. New actual-shape test fails before patch and passes after; source unchanged and explicit price/invalid EA/missing cost/inactive/currency guards covered. Public success not yet established.

Release candidate only: no Pages deployment, Wix publication or real public success yet. No main merge or new user-frozen tag. Existing user Purchase draft is not touched. Next steps: minimal Wix line replacement/readback, GitHub PR, separately authorize new branch Pages deployment, all four release stages, actual reference-only Catch Cost in an agent-owned acceptance page without PLAN/save.
