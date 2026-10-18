# Fixed MASTER header and navigation

Scope: keep the two existing shell rows visible across Purchase, Account, Warehouse and Support. Preserve the original DOM, company controls, staff identity, navigation handlers, business messages, saves and downloads.

Before editing, all four Wix page entries and eight relevant public assets were captured and matched the checkout. Immediate recovery is runtime d92544a and record30dfd21; limited user-verified purchase reorder and PO checkpoints remain identified by their existing annotated tags. No main merge or new broad verification is implied.

The shared presentation stylesheet makes the existing header sticky at0 and nav sticky below its measured height. A small shared ResizeObserver updates only two CSS height variables, including narrow-screen wraps; the existing Purchase pending-save tracker and room header use their combined offset. Desktop department Refresh controls retain their handlers and fixed placement in the header. Inner table scrolling and dialog mechanisms remain unchanged.

Wix has an independent outer scroll layer. Each department html1 is set through the native inspector to Page Pinned, width100%, height100vh, left/top docking with zero margins, no new min/max constraints. Support, Account and Warehouse originally used Stretch inside section4 height850px. Purchase originally used Relative width with1265x1100px inside section4; its separate section2 remains unchanged. Native conversion adjusted widths to98.8% and Purchase top margin to-54px; these were explicitly corrected before release. Original layout snapshots and exact code copies remain in the private root handoff. Native layout changes must be reverted through the same inspector if recovery is required.

Validation: local Chrome source-selection sample preserves enabled compatible mother/source rows, disables other suppliers, and retains selected cancellation. Long-list scroll205.6px leaves header top0 and nav top49. At640px viewport Purchase header wraps to70.3px and nav top matches70.3px. Account, Warehouse and Support share header49/nav top49; desktop Refresh stays fixed. Full534 checks531pass with the same three pre-existing failures as the baseline; no new failures.

Related selection patch is isolated in c092c42 on fix/purchase-merge-selection-20261018; header branch builds on it for one eventual release. Status: code candidate only. GitHub Pages, Wix publish receipt and public acceptance remain pending.
