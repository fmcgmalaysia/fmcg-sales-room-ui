# Buyer order success confirmation

## Approved direction

On 4 November 2026 the user asked to finish the Order Received popup without submitting another order, then explicitly allowed modifying the popup and removing the post-submission Excel download. The requested English message is “We’ve received your order!” with a lively illustration and a tested PNG.

Recovery is `44c698f3`, with the prior user-verified Selection Excel tags retained. Both Wix files had been restored and published after the failed `70b33f33` candidate. The restored public TESTING 801 page subsequently rendered normally with 7UP 101 and AJAX 100; no request was repeated. A fresh Buyer Wix capture exactly matches the restored page, and the public Buyer HTML SHA256 remains `c1ed53afb20cde86fd6293002fa5556ba8dcb4b803dc22768a26e371914844f4`.

## Minimum implementation

- The existing successful order result opens one confirmation inside the Buyer page. It reuses the already published `order-received-flow-v2.png`, English copy, a close control, and View My Order. No new image, external library, endpoint or storage is introduced.
- The Wix submission handler acknowledges the existing backend result immediately. It no longer prepares Order Excel or calls the native Order Received lightbox. Post-confirmation workspace failure is logged separately and cannot convert success to failure. Submission identity, server authorization and idempotency are unchanged.
- The existing completed Request Sent progress button can reopen the same confirmation from an already loaded, known order. This is read-only and performs no submission, quantity save, export or additional fetch. Other progress buttons remain unchanged. It enables public verification without another order.
- Native My Selection Excel, image hyperlinks, currency headers, immutable backend receipts, transaction history and file access remain intact. The old native lightbox source is retained for recovery only; there is no remaining production call to it from Buyer. It is not a parallel confirmation route.

## Validation and scope

The scoped package contains 101 static resources: only Buyer HTML changes; the other 100 hashes equal the current published manifest, including Sales, MASTER and the reused illustration. One Wix page has three isolated substitutions: remove unused order-export import, replace submission feedback block, update build reference. Its complete draft readback matches the candidate exactly. Backend files and native Selection Excel code remain byte-equivalent to the recovery baseline.

Local candidate UI: existing Request Sent opens the English dialog; View My Order returns to Current Status; X closes; reopening works; primary button is green with white text. Focus return, Escape and focus cycling are covered. The candidate is visibly labelled local and cannot submit production orders. PNG: `handoff/buyer-order-confirmation-20261104/ORDER_RECEIVED_CANDIDATE.png` in the local workspace.

The previous real 1 CTN test remains the only addition: receipt suffix `434735C26F33466EB863967FED679C69`, 7UP 101, AJAX 100. No MASTER transfer, payment, receipt replay or further order is authorized by this verification plan.

## Release gates — completed for the confirmation

- Code: runtime `1b3aa789`, PR342; 101/101 Buyer checks passed.
- GitHub Pages: one `buyer-order-success-only` run #342 / `41844696942` completed successfully for exact SHA `1b3aa7898cc8c955874ebde0feda4b274e33dcdc`. All 101 public resource hashes match. The temporary branch rule was removed immediately after success; the original seven names match the saved pre-release list.
- Wix: single draft rechecked exactly before publication; Studio explicitly returned published and live. Exact source and receipt screenshot retained locally.
- Public: Sales Room → TESTING 801 Workspace → Enter Buyer Room opened a new formal page with the correct customer and `20261104-buyer-order-success-v1` in both iframe URL and loaded HTML meta. The existing completed Request Sent button opened the English illustration dialog. View My Order returned to Current Status; X closed it; reopening worked. Green button/white text verified from actual computed styles. 7UP remains 101, AJAX 100. No fresh submit was used.

Formal screenshot: `C:/FMCG-WIX-LOCAL/handoff/buyer-order-confirmation-20261104/ORDER_RECEIVED_PUBLIC.png`. This shows an existing request reopened for verification, not a newly submitted order. The post-submit transition itself is covered by the real handler tests; no new production order was created to repeat it.

## Separate observations, not completion claims

An ordinary reload of the old formal tab again showed the correct new iframe source but an actual about:blank frame with Wix fallback logs. The existing Sales Entry then opened a fully working new formal page without user help. This is not proof that the intermittent Wix-loading cause was fixed.

The original My Selection native Excel link is visible and its protected program block and backend remain unchanged. The browser download-event wait yielded no file; one subsequent native link click reached Chrome `ERR_BLOCKED_BY_CLIENT`. No new matching file appeared in Downloads, no security setting was changed and no bypass was attempted. Returning normally to Buyer restored the working page and confirmation. This separate download-route observation remains unresolved; do not claim a new successful download regression test. It does not restore the removed post-submit Order Excel step.

User real-world confirmation is pending; do not merge ancestry into main or create a user-verified tag. Earlier failed candidate, intermittent blank-page root cause and the separate native download-route observation remain distinct from the completed formal confirmation checks. Long-term CMS and historical PDF backlog are unchanged.
