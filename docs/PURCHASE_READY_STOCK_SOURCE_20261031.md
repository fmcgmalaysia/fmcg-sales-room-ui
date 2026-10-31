# Purchase ready-stock source display

Objective: confirmed stock assigned to customer demand must appear as a stock source, with no false orange unplaced balance. The box opens a read-only source view; ALLOC remains the existing mutation entry point.

Baseline: published short-load release `8b203b5`, documentation `cb33884`, PR251. The fresh Purchase Wix page matches the repository exactly; four relevant public resource files match the existing scoped release plan after line-ending normalization. Private originals and test evidence are in the root handoff directory `purchase-ready-stock-source-20261031`. Existing annotated verified tags retain their historical scope; this new candidate is not a user-verified production baseline. Separately deployed receiving backend `fc76b37` is preserved and is never replaced from this checkout.

Implementation: isolated patches in `integration/prototypes/purchase-ready-stock-20261031/patch.cjs`, applied by the existing release composition mechanism. Five Purchase resources change out of 94; the other 89 stay byte-identical. No backend, CMS, financial, inventory, or other department code changes. Purchase Wix changes only its version token.

Coverage takes procurement quantities plus confirmed allocated quantities exceeding the same source's existing procurement coverage. It does not add an owned source's procurement and allocation twice. Split rows use saved batch bindings, with excess capped by the source's whole-order excess; moving an owned source between batches does not manufacture extra stock. Original PO amounts and supplier receipt responsibilities remain unchanged. No new automatic allocation or Desk assignment is introduced.

Ready Stock uses a pale status label and a blue clickable box. Borrowed sources retain their borrowing label and show the lender plus outstanding loan in the read-only view. Quarantined sources say Stock review. Pure stock coverage has no artificial procurement PO action. The stock row cannot be selected as a supplier PO source. Returning ownership updates the same projection and exposes the remaining gap again. Loaded or invoiced ownership is never released by this display code.

The detail view shows original supplier/PO, receiving update timestamp, source-allocation update timestamp and employee, using existing projected fields. These are explicitly update timestamps; the current projection does not provide a separate first receipt timestamp or immutable target-specific allocation timestamp. Missing values stay blank.

Acceptance: 12 new tests pass for 90+10, 90+6, unconfirmed draft/failure, return, own excess, pure stock, borrowing/repayment trace, quarantine, protected loaded ownership, split binding, cross-batch no duplication, read-only detail and unchanged resources. 68 affected regression tests pass using the actual candidate grid and allocation UI, including original source rows, split inline layout, personal row order, borrowing and the 25 short-load scenarios.

Release state: candidate only. GitHub Pages deployment, Wix publication and fresh public verification remain pending. Never merge this branch into main before user acceptance.
