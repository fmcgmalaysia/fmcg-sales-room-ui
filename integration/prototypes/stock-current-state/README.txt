G0 stock commit protocol proof — OFFLINE ONLY — NOT PRODUCTION READY

Receipt continuation: receipt-stock-plan.cjs plans cumulative receipt DIFFERENCES and
coalesces receipt+source/claim/product changes, no live entry.16new receipt tests pass;
converter9and existing warehouse7 pass. See handoff RECEIPT_ADAPTER.txt for exact limits.

2026-10-21 actual SDK continuation: stockProtocolCommitTest.web.js is an isolated Admin
DRAFT diagnostic. Exactly3approved lock-release cycles and interrupted/resumed/replayed
Wix stages passed in StockProtocolTest. Business collections are not used; no production
imports/activation. See handoff FULL_PROTOCOL_PROBE.txt/LIVE_COMMIT_RESULT.json. Actual
application failure recovery is evidenced, not all network timeout or platform limits.

Read candidate continuation: current-query.cjs provides bounded company-scoped SDK-shaped
product/source/claim queries;7new tests pass. No production imports or live index changes.
See handoff CURRENT_QUERY_CONTRACT.txt for limits; mock paging is not measured Wix speed.

2026-10-21 continuation
fenced-proof.cjs is the revised injected conditional-store protocol (21new checks pass).
current-model.cjs converts a complete legacy projection once, preserving current/lifetime
quantity boundaries, then defines a bounded current-product repository read (9checks pass).
Neither module is imported by production. Original unsafe counterexample below is retained.
stockProtocolTest.web.js is an authorized Wix DRAFT Admin diagnostic for StockProtocolTest;
its two retained rows are synthetic. Both old-wrapper patch probes failed INVALID_ARGUMENT,
not a version condition. Current official SDK has a different supported conditional API.
stockProtocolSdkTest.web.js is now an exact-readback Wix DRAFT, Admin only, using approved
@wix/data1.0.528. Actual conditional updates and conditional lock release passed; two
fixtures remain, exactly one separately authorized disposable lock was deleted.
sdk-conditional-store.cjs is an isolated injected adapter candidate (5tests pass), not
production wiring. Protocol21tests pass; canonical property comparison ignores key order.
See LIVE_SDK_RESULTS.json in the handoff for actual returned evidence. Full adapter/live
recovery/writer coverage remains incomplete; ACTIVE stays off. Do not rerun fixtures.
See handoff/stock-current-state-protocol-20261021/SOL_IMPLEMENTATION.txt for exact results.

Purpose
Exercise the proposed current-state commit steps without editing the existing company
journal, Wix adapter, runtime imports, CMS, permissions or deployed websites.
commit-proof.cjs has no authenticated production endpoint and must not be wired to Wix.
It uses synthetic records and an injectable store. It is not a finished inventory model.

Reproduce from repository root
node --test integration/tests/stock-current-commit-proof.test.cjs integration/tests/stock-card-save-safety.test.cjs

Observed 2026-10-21
31 tests passed: six existing journal/allocation safety tests; 24 ordinary new protocol
checks; one counterexample reproducer that PASSES by demonstrating unsafe divergence.
Passing the test command is NOT passing G0 or proving inventory correctness.

The counterexample
1. Source has 220 on hand / 200 reserved; product summary has 20 available.
2. Operation A allocates 10. Its source update is queued but returns an unknown-outcome
   error before the queued write takes effect. Persistent pending remains.
3. Retry A observes the before-image, writes reserved210, completes other records and
   publishes generation1. A's first request is still unresolved at the storage boundary.
4. Operation B allocates remaining10 and publishes generation2 with reserved220/free0.
5. A's first queued update now executes and overwrites the source with reserved210.
6. The company control still says generation2 with no pending. Source and summary differ.
   Reading the control twice does not detect this late overwrite.

Evidence scope
CONFIRMED: under this explicit store schedule the proposed overwrite-after-image protocol
fails. Ordinary before-write rejection, completed-write/lost-reply, lock exclusion and
RESULT-finalization recovery pass in the simulated store.
UNKNOWN: whether a rejected/timeout Wix Velo update can still commit after its caller has
observed rejection, and what enforceable cancellation/completion guarantee applies.
No actual Wix delayed-write fault, existing deployed stock loss, or production data
corruption was observed or induced. The test is an architecture counterexample, not
a report that the user's existing system has suffered this failure.

Why this matters
Unique inserts stop competing LOCK acquisition. Strongly consistent reads show committed
values. Neither alone proves that an earlier uncertain overwrite cannot arrive later.
An application revision checked BEFORE a write is not a database conditional write.
Do not repair this by sleeps, extra blind retries, automatic lock expiry, periodically
overwriting source from summary, or silently reading the old historical model on errors.

Required Astra review before G1/G2
- Can the actual current Wix adapter guarantee no late write after a reported failure?
  A documentation assertion or platform contract is needed; a few successful tests do
  not prove impossibility of the failure schedule.
- If not, choose an enforceable conditional-write/fencing mechanism, immutable version
  publication, or a conservative unresolved-operation stop policy. Evaluate row growth,
  read cost and compatibility before choosing; no alternative has been implemented here.
- Preserve existing same-company scope, original permission checks and verified business
  behavior. Any production journal change still requires fresh live/repository comparison.

Prototype limits
30 write records and180000 serialized bytes are deliberately small proof limits, not
measured Wix production limits. No product search/index implementation or benchmark exists.
Synthetic identity checks are not employee authorization. Plain JSON records do not model
Wix system timestamps/hooks/schema/index behavior. The proof has no manual lock recovery.
It assumes every participant follows the lock/control protocol; old clients and other
writers have not been integrated. No full business matrix or public acceptance has run.

Official documentation checked
https://dev.wix.com/docs/sdk/business-solutions/data/items/insert
  Explicit duplicate _id insert rejection; item maximum500kb; SDK developer-preview page.
https://dev.wix.com/docs/sdk/business-solutions/data/items/update
  Replacement update; absent fields can be lost; item maximum500kb; SDK developer-preview page.
These SDK pages document the relevant operations but do not settle the current Velo
adapter's timeout/cancellation behavior or promise a multi-record transaction.
The existing actual adapter in customerFulfilmentService.js uses wix-data, consistentRead
queries and ordinary insert/update/remove. It has not been modified by this proof.
