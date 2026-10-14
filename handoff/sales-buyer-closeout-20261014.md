# Sales and Buyer closeout — 14 October 2026

The user requested completion and publication of today's remaining work. The candidate preserves the formally restored QTY layout in `4f8ae7d`, adds the previously requested amber loading colour and corrected Goods Expiry help, and removes the forced empty Wix outer scrollbar on Buyer Room only. Buyer retains its real internal scrollbar. Original global CSS rules and all business handlers remain intact.

The existing global CSS was read from Wix Studio and matched the preserved repository snapshot in `handoff/room5-day-closeout-20261007/live/global.css`. The current candidate mirror is `integration/wix/source-global.css`. Its single addition changes `overflow-y` to `auto` only when the body contains the Buyer embed. No iframe height, downloads, authentication, storage, quantities, expiry data, or backend mechanism changes.

Earlier published work: My Customers stability and copy, editable review P.O. and shipment planning with existing locks, post-transfer Sales date permission and departmental read projections, six-stage progress, compact descriptions and typography, English green Buyer design, Sales/Buyer menu icons, preserved Administration, immediate Review loading, and distinct active-customer progress badge. See the existing release JSON files for exact scope and public verification.

Recovery record: `integration/releases/sales-review-qty-alignment-20261014.json`. Initial recovery without a new embed version left the public browser on the stale 104px layout. A new Sales URL token resolved that cache; the formal unsubmitted order then had a 162.2375px QTY cell with quantity and pencil on one row.

Validation: 17 Sales loading/edit/submission checks and 28 Buyer compact/history/zero/draft checks passed. The release remains a candidate until GitHub Pages, Wix live synchronization, and fresh public checks all pass. Deployment permission must be scoped to this release branch and removed afterwards. No main merge before user real acceptance.

Warehouse expiry source integration remains deferred by the user. Actual submission and post-transfer shipment-date saving remain user acceptance steps; this closeout does not write business data. Historical Excel work remains outside this release.
