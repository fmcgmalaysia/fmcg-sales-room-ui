# Purchase right gutter — 2026-10-16

Objective: restore the existing right page gutter. User screenshot showed Incoming Alert and the task table touching the right edge.

## Evidence and minimal layout repair

- Recovery source: `1706ef53236f0db59b52e5055f8ea6404171b2a2`, with unchanged public calculator-save-v2 runtime. Existing limited user-verified checkpoints remain `verified/purchase-allocation-layout-20261015` and `verified/purchase-lavender-plan-po-20261014`; this record does not extend their scope.
- Fresh formal Wix outer viewport measured1520.800px. Purchase iframe measured1539.075px, extending18.275px beyond the visible page. The app already had20px horizontal padding, leaving only about2px visible on the right.
- Fresh Wix Studio Purchase page code matched the preserved v2 source exactly. Inspector identified `#html1` / `comp-mv1th002`, relative width1280px* and right margin-15px* at the1280 desktop editor breakpoint (section visible width1265). The negative margin and oversized width caused the overflow.
- Only this component's right margin changed -15→0 and width1280→1265px*. Responsive behavior Relative width, height1100px, elementID, section, src, message handlers, backend, and all purchase business logic remain unchanged. Editor readback showed X0, right0; element right matched parent right1264.800px (subpixel left-0.2px due to scaling).
- To restore layout only, select Purchase `#html1` and restore width1280px* / right margin-15px* at the same1280 desktop breakpoint. Do not roll back current business data or the calculator/partial-save runtime.
- Exact full page code before and after compared equal and is preserved locally. Screenshots and hashes are retained; no application source was edited and no CMS business save was made.

## Publication

- Code: no runtime code change; separate layout record branch `style/purchase-right-gutter-20261016` from1706ef5. Main is unchanged.
- GitHub Pages: existing `2026-10-16-purchase-calculator-save-v2` marker and index content freshly verified equal to repository. No static build/deployment or deployment-policy change is needed for a Wix component geometry change.
- Wix Studio: published/live confirmation captured in publish-receipt.png.
- Public verification: after confirming no modal, Save action, draft or pending operation on the current public tab, reloaded the same formal URL. Fresh Wix layout measured component right1520.79998px versus viewport1520.80005px, right margin0, so the overflow was removed. User subsequently replaced that tab with a fresh official tab; reused it without opening another window. Active Orders visually verified: about20px left/right content gutters, incoming/pending buttons and table inside the visible page, no relevant error. Dashboard also loaded with correct real records. CHIPSMORE remained50/35 plus WAITING15; ECLIPSE remained100/100 plus stock10. No business save was repeated. Screenshot public-after.png preserves the final Active view.

Validation is direct editor geometry, exact unchanged Wix-code readback, fresh unchanged Pages marker/content, and real public visual/data readback. No new application tests were added or rerun for this isolated Wix geometry adjustment.

Evidence directory: `C:/FMCG-WIX-LOCAL/handoff/purchase-right-gutter-20261016/`. See evidence-hashes.json for full Wix page snapshots and editor/publish screenshot hashes. Official URL remains https://fmcg999.wixstudio.com/master .
