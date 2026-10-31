# Purchase allocation origin display

MST-01 backend/UI candidate only. No Wix synchronization, release packaging, public verification or user acceptance yet.

The old Info model labels an entire source Borrowed whenever any historical loan references it. Thus a saved80 allocated from20 free and60 borrowed is shown as Borrowed80. Outstanding debt cannot repair that display: returning20 reduces historical borrowed cartons to40, whereas repaying40 settles the debt without removing those40 cartons from the borrower's historical source.

The new read-only `allocationOriginInfo` projection consumes existing saved allocation predecessors and loan revision chains. It retains the original borrowed quantities, subtracts only evidenced unshipped returns (explicit RETURN or Support shortload cancellation), and keeps provenance when a REPAY event settles responsibility. Shared decreases in the same source/event are consumed only once. Missing predecessor evidence, conflicting chains or uncertain batch attribution decline a precise breakdown. No events, stock balances or new mutable ledger are created. This projection is used only by Purchase Info and never by allocation availability, quantity validation or writes.

`purchaseProjection.js` adds one import and one output field after existing canonical loan validation. Fresh complete Wix original matches repository, normalized SHA256 `7f79075978922a60ea198426e01d958e0642cb461a5fa14b74ea885d039af13c`. The new helper has no prior live version. The frontend release composer changes only task-info model rows and its HTML version reference; old/missing origin evidence uses a neutral Source total, never the old false Borrowed80 claim.

Validation: 8 origin-history cases and64 existing allocation/shortload/Purchase/stock projection checks passed in a72-case run;7 additional generated-UI model cases passed. These79 distinct checks include mixed80=20+60, return20→20+40, repayment preserving40, full return leaving free20, ambiguous batch, missing history and shared-source returns. The original generated renderer reproduces Borrowed80 before the fix. Input events and allocated totals remain unchanged.

Pending: actual browser Info preview, broader shared-projection regression, minimal Wix helper installation and projection readback, limited release integration, public verification. Do not include this unfinished candidate in the already prepared `0d6b492` Warehouse release or silently expand that permission request.
