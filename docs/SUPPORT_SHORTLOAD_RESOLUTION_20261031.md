# Support short-load resolution — implementation in progress

Single objective: Support disposes of confirmed undelivered cartons by continuing loading, transferring them to another Desk, or cancelling the remaining customer demand. Purchase and Warehouse consume the same receipt. Loaded remains the only physical stock authority.

Recovery: static package `purchase-received-review-v1-10e2a88` (94 assets), frontend record `384659a`, separately deployed receiving backend `fc76b37`. Fresh Wix originals are retained privately under `handoff/support-shortload-resolution-20261031/live-before`. Existing annotated verified tags protect their specific historical workflows; this candidate is not a new verified baseline. Never replace unrelated live backend code from this checkout.

The existing Desk assignment moves a whole task. It must not be used to move the remaining 10 cartons of a 100-carton task after 90 cartons have loaded. Quantity portions retain the task identity and sum to the effective customer demand. Original loading, procurement, payment, and invoice facts remain unchanged.

Planned acceptance: 100/90/10 continuation; 90+10 across two Desks; cancellation releasing only unshipped ownership; mixed 6+4; zero loading; repeated request; concurrent loading/disposition; invoice each Desk in either order; outstanding borrowing and quarantine; cross-company rejection; no financial fields in Warehouse. Red clears only after a persisted disposition, with continuing loading pending rather than complete.

Validation before release: 25 new synthetic scenarios pass, including actual Purchase projection, Sales batch demand, borrowed ownership, quarantine, lost acknowledgements, simultaneous loading, and Desk invoice order. The affected regression suite passed 273 of 275 checks; the two failures reproduce on the original checkout (historical Support release assembly and obsolete page-layout contract). Subsequent focused 59 checks passed; the final multi-line processing scenario also passed.

Chrome synthetic preview verified 100 allocated / 90 loaded: transfer leaves Desk 1 at 90/90 and Desk 2 at 10/0 with matching amounts and CBM; continue displays pending, and confirming 100 reduces physical stock only by the additional 10. No CMS test records are created. Warehouse receives only the existing operational allowlist plus nonfinancial resolution quantities.

A completed decision is one immutable activity event consumed by existing demand, allocation, borrowing and Desk readers. It does not create an alternative stock writer. The existing operation journal supplies same-request recovery. No periodic new history is added.

Release is not yet complete: GitHub Pages, Wix publish and public verification are pending. Keep this branch out of main until user acceptance. New modules must be created before importing them in the minimal live patches; the separately deployed receiving backend is untouched.

Wix prepublish check: all 13 existing backend modules were patched through unique Find/Replace hunks and fully read back, two new modules were fully read back, and all three page references were changed only at the version marker. Exact code: 4054f2f. All fresh page originals matched the checkout. Pages permission and publication remain pending.

Final concurrency review: a rejected stale prepared decision now receives a terminal failed outcome in the existing journal. It is not offered forever as an unconfirmed request. The 25-scenario suite passes, including conflict acknowledgement, same-request replay, no pending recovery entry and a fresh successful decision. The exact single-hunk Wix readback was verified. Static assets are unchanged by this correction.
