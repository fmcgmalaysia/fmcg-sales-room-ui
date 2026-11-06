# Purchase receipt and supplier UX release review

Candidate build: 20261106-purchase-receipt-ux-v1. Recovery: 0d19c3ab, protected published supplier dialog/image v2. The user approved keeping the three fresh formal static originals. Five Wix files were captured and matched before editing; minimal hunks applied, full normalized readbacks match every candidate file. Wix IDE Sync site completed. No site Publish performed yet.

## Changes
- Permanent source quantity lock after first positive accepted or rejected physical receipt, including corrections to zero. A new receipt between PREPARED and apply blocks uncommitted quantity change; an already committed original request can finish recovery. Pay Slip full lock unchanged. Only affected source is blocked.
- Calculator supplier saves no longer demand a typed reason. Existing-PO amendments appear in collapsed PO Changes with original actor/time and before/after. Initial setup is excluded. No extra audit event is added.
- Orange unconfirmed Transport prompt; Supplier and Action headings; confirmed save feedback permits editing other drafts while subsequent writes still wait for authoritative fresh versions.
- Personal pointer drag, local automatic preference, root plus children move together; no destination popup, Activity or CMS write.
- Aligned parent demand/child source quantity dividers, ordinary row weight, actual PO plus date and actor. Stored PO numbers unchanged.
- Red active receipt exceptions, retaining resolved and zero-gap finance-review semantics; compact Allocation/Receipts with actual recorded time and actor. Normal one-receipt date retained.
- Existing 10-second poll also refreshes receipts while editing. Only receipt fields and receipt issue buttons are updated; commercial inputs remain. No faster polling or extra timer.

## Evidence
174 current affected checks passed, zero failures (final-tests-v2.txt). Eight new scenarios cover permanent receipt lock, late receipt, original request recovery, zero correction, per-row save responsiveness and history. Existing shared tests cover Warehouse, Desk, finance locks, projection, intake images and month-end loss.

Four historical release snapshot assertions still fail in their older packaging suites and were reproduced before this patch: three in baseline-ui-failures.txt (legacy quiet packaging hunk and receipt Info snapshots), one in baseline-receipt-review.txt (old Wix version token). They are not business failures fixed or hidden by this release. Three old mandatory-reason expectations were explicitly updated to the newly approved no-reason rule; legacy non-calculator reason guards remain.

Foreground Chrome synthetic preview: personal drag moved complete root group; receipt 70+30 automatically appeared; quantity100 became disabled while price17.00 and Self Collect remained. No console errors. Preview blocks every business write. No real PO/receipt/payment/Loaded was replayed. Native foreground input was needed where a browser semantic click only focused the control.

Package: 96 resources, nine Purchase assets changed and87 others byte-for-byte retained. All JS parses; manifest hashes and scoped workflow gates verified. No FMCG backend change. Four MASTER backend modules plus one Purchase page version draft.

## Remaining release stages
Code candidate tested; GitHub sync pending at this record creation. Pages new branch deployment permission pending; original seven policies must be preserved and restored. Wix publication and fresh public Purchase visual/function verification pending. Do not call the task published until all four stages pass. No main merge without user real-world confirmation.

## Practical limits
Automatic receipt visibility follows the existing10-second poll plus server response, not an instantaneous server push. Save improvements remove post-confirmation UI blockage; no measured reduction of Wix server commit duration is claimed. This task does not implement the separate long-term CMS capacity/read redesign.

## Formal v1 acceptance and minimal v2 follow-up
Pages42171431898 succeeded,96/96 hashes exact, temporary policy removed and original7 restored. Wix confirmed published/live; all5 drafts freshly matched before publish. Formal Purchase fresh user tab51431985 runs20261106-purchase-receipt-ux-v1 with LAW. Parent/source dividers, normal receipt date, PO date/actor, supplier no-reason layout and PO history confirmed. Real AVATA PO888888 history shows500→300 at06-11-26 09:12 by LAW with WAITING200. Received Beauty Mama PO7777 quantity300 readonly; exited without changing records. No relevant console errors.

One requested display remains incomplete: existing active-layout.css hides source receipt case buttons. The red−50 button exists with original data-quantity-case but computes display:none. This hiding rule predates the patch. v2 adds one narrowly scoped style override for active source receipt cases, preserving resolved/zero-gap finance-review behavior; no business JS/backend change. v2 has2 static resources different from v1 (style plusindex),94 retained, all96 hashes/syntax pass.16 related checks pass. Local synthetic−50 now inline-flex/red#E51B2B/white, no errors.

Automatic approval rejected writing the v2 Wix page token because the user-specific release approval covered v1 only. No v2 draft write occurred. Need explicit approval for the single page-token draft plus one additional scoped deployment permission; v1 remains live and original7 rules restored. Do not claim full requested publication until the red source action is visually verified publicly.
