# Two-site closeout — 2 November 2026

Current candidate extends the versioned, freshly compared 28bcf9a production bundle. Customer invoice matching/history (5b0fe72), Sales Department (dad6795), and Buyer refresh coalescing (22caddc) remain distinguishable checkpoints. Main is untouched. No new receipt, stock adjustment, payment posting or commission payout has occurred.

## Evidence-led patches

1. Buyer had two periodic workspace readers: Wix parent15s and visible iframe60s. One visible-frame15s reader now retains the previous visible freshness, while read-only bursts coalesce. Mutation readback stays fresh and superseded results cannot overwrite it. Hidden frames stop periodic reads. Five behavioral checks pass.
2. Finance additional payment-proof uploads now retain the existing payment reference. The existing paymentId and append-files writer remain unchanged; no second cash transaction is created. Missing payment identity does not open an orphan file-upload form.
3. Warehouse automatically clears only the two resolved, local missing-reason validation messages after valid receipt input. Pending save, server failure, quantity validation, correction reasons and stopped-receiving guards remain intact.
4. Finance shows unknown values while Supplier Accounts loads, rather than presenting false zero totals. Confirmed empty results still show real0. Finance shipment labels use ETD without changing date values.

Four focused audit checks pass. Initial test-harness failures are preserved in the root handoff; they were missing harness function/date context, not bypassed production guards. The patches are small transformations of the exact published files. Older raw Warehouse/payment-layout sources are not substituted for the newer verified bundle. The patch registry and final resource hashes are the reproducible source for these transformations.

## Still required before a complete release

Both Wix Studio editors remain in platform startup. Master console reports a Wix-owned fedopsLogger ReferenceError; this is recorded, not patched by injecting vendor globals. Fresh originals were captured before candidate implementation. No candidate draft synchronization or publish receipt exists. Public Finance and Purchase on28bcf9a are accessible through the existing in-app browser: confirmed/unconfirmed Payable distinctions and the locked payment-request detail were read without saving.

The final package has105 static resources,18 differences from28bcf9a. It includes the prerequisite customer-payment/history and Sales Department work; four existing source-site page version references need synchronized publication with backend dependencies. Actual customer PDF delivery, ordinary customer/staff role access, actual receipt matching and commission policy/data remain separate acceptance or business-definition items. Do not mark them complete from isolated tests. SUNQUICK barcode and cost migration remain explicitly deferred.

GitHub Pages restricted deployment, exact resource verification, Wix published/live receipts and fresh public-page tests remain mandatory. No temporary deployment rule has been added for this branch.
