# Missing reference unit cost — 2026-10-19

Objective: A&W barcode9555589200293 Catch Cost is rejected. No UI redesign, intake change, source-price update, CMS write, quantity, authorization, lock or financial change.

Evidence: existing POINTBASE FOOD row754 read through native Sheets UI; ACTIVE, EA24, COST/PC blank, COST/CTN44.40, discounts0/0/0, NET44.40, CBM blank. Header and displayed row preserved privately. Original sheet selectionF655:F670 restored, no sheet edits. Actual Purchase error screenshot is generic Wix backend failure. Fresh Wix purchaseOperations.web.js10238chars matched repository before edit; private exact copy in C:/FMCG-WIX-LOCAL/handoff/purchase-reference-unit-cost-20261019/.

Reference gate permits missing-CBM-only snapshots only when all five price fields are finite. POINTBASE intentionally permits absent per-piece cost. The actual source shape reproduces POINTBASE reference is unavailable in the existing endpoint test before repair.

Minimum patch: inside getPurchaseReferenceCost only, copy the fetched snapshot and derive absent lpPc=lpCtn/eaPerCtn when carton cost is positive finite and EA positive integer. Original response snapshot not mutated; explicit per-piece cost authoritative; no rounding of internal precision. Existing identity/currency/time/status/cost-issue gate unchanged, including rejecting inactive products, missing carton cost and invalid EA. No other web method or transport changed. UI displays1.85 and44.40, from44.4/24, on success.

Recoveryb96d319 / runtime69e1ec7; limited annotated verified/department-ui-before-20261018 retains its prior scope. 38focused allocation/reference/retry tests pass. New actual-shape test fails before patch and passes after; source unchanged and explicit price/invalid EA/missing cost/inactive/currency guards covered. Public success not yet established.

Release candidate only: no Pages deployment, Wix publication or real public success yet. No main merge or new user-frozen tag. Existing user Purchase draft is not touched. Next steps: minimal Wix line replacement/readback, GitHub PR, separately authorize new branch Pages deployment, all four release stages, actual reference-only Catch Cost in an agent-owned acceptance page without PLAN/save.

Candidate61eb271/PR205 pushed. Wix single replacement saved in draft only; full after-readback exact to repository. No publish clicked. Temporary Pages branch permission required before release. Public getReference success remains unverified; user's existing Chrome draft untouched.

## Four-stage release and actual success
User authorized temporary fix/purchase-reference-unit-cost-20261019 deployment policy. Pages run39195510957 succeeded at5a57d33; temporary policy removed and original seven exact restored. Public backend source and existing Purchase/Warehouse UI indexes match repository; unchanged UI markers retained because patch is backend-only.

Immediately before publication, fresh complete Wix module readback exactly matched approved draft. Wix Studio returned Congratulations / This site is published and live online. Screenshot and exact before/after saved privately. No other module, Apps Script or POINTBASE change.

Agent-owned authenticated public Purchase page reloaded as LAW. Actual unassigned A&W9555589200293 demand50 opened: per-piece blank, carton44.40. First HONG LEA selection performed only in that agent-owned draft; exactly one Catch Cost click. Real server response: calculator filled LP/Pc1.85, LP/Ctn44.40, discounts0/0/0, Net44.40; visible success message. No captured page error logs. Screenshot public-aw-catch-success.png. No PLAN/save, supplier assignment persistence or financial operation; original user's Chrome page/draft untouched. Agent-owned IAB3 retains this unsaved acceptance draft as visible evidence; it must not be mistaken for a saved purchase or submitted silently.

All four release stages complete for this reference-only repair. No main merge or new user-frozen workflow tag. Existing Chrome-opening root issue and broad SAVE latency remain separate/deferred. Private evidence root handoff/purchase-reference-unit-cost-20261019 contains source row, reproduced-before/tests-after, run/policies, pages comparison, Wix receipt and public success screenshot.
