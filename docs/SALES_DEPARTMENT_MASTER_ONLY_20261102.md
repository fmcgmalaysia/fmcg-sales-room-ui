# Sales Department placement correction

User correction, 2 November 2026: Sales Department belongs in MASTER. FMCG Malaysia must not serve internal costs, profit, GP or commission. The prior Sales Room placement was an implementation error, not an approved business boundary. The user explicitly requested complete removal rather than hiding the menu and confirmed deletion of the three erroneous Wix backend modules at action time.

## Immediate removal

- Fresh source Sales page and MASTER customerFulfilmentGateway match the e0ac431 published copies. Exact before/after originals and hashes are retained in the root handoff.
- Remove the source page's department import and message handler. Preserve its customer/order/transaction-history handlers.
- Remove the internal department action and service import from the existing MASTER customer bridge. Even valid shared bridge credentials and a full customer/staff envelope cannot retrieve internal department data. Existing sanitized HISTORY remains available.
- Physically delete source-site backend salesDepartment.web.js, salesDepartmentAccess.js and salesDepartmentClient.js, with no replacement proxy or stub. All three disappeared from the Wix backend tree; FMCG returned published/live. MASTER also returned published/live after closing the bridge action. No customer-site backend may remain connected to the internal service.
- The static removal package derives from the hash-verified e0ac431105-resource release. Remove all four sales-department assets and the Sales shell script reference. Only index.html changes; the other100 retained assets are byte-identical. The internal presentation files are preserved under master-sales for subsequent MASTER-only implementation and are not shipped in this removal package.

The new constrained workflow is customer-site-isolation-only. The deleted integration cannot be rebuilt from current source by its former builder; old historical commits remain recovery evidence, never a reason to redeploy the wrong placement. The isolated current package is independent of that historical builder.

## Protected behavior and checks

No invoice, receipt, payment, supplier, stock, Loaded, customer identity, document-sharing or accounting record is modified by this correction. The existing customer history still excludes internal costs, FX and employee identifiers. Initial affected run65/65 passes; the subsequently added physical-deletion check is separately required. Existing historical tests that asserted the wrong positive source bridge are superseded by denial checks, not evidence that the removed behavior should be restored.

## MASTER implementation boundary

Use MASTER member authentication and StaffMasterAccess, restrict server-side to Sales and authoritative assigned customers, and read local NCT/GHR Finance ledgers. Do not use submittedByStaffId as ownership: an administrator may submit on another salesperson's behalf. Verify the actual assignment/profile authority before connecting the new page. No internal financial projection is sent to FMCG. Existing customer profiles and transaction history must retain their existing authorities; this correction does not authorize a second customer directory, a fabricated commission payout or an inferred customer assignment.

## Outstanding evidence

Static deployment/removal verification, public Sales menu absence and preserved transaction history remain required. The current public session may retain the old shell until a fresh navigation. The preceding closeout's GP no-growth acceptance failed: activity count2904→2923, visible newest events repeatedly GP_RECALCULATED for the same task at08:30–08:32. This is not solved or deleted; unrelated tests paused for the placement correction. Buyer/Support PDF/payment acceptance, ordinary-role access and the other tracked business contracts remain open. Do not claim the full previous closeout is accepted.
