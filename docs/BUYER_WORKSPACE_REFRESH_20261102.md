# Buyer workspace refresh audit

Candidate only; not deployed. Fresh Buyer Wix source captured in the same session matches baseline5b0fe72. Visible iframe15-second polling replaces the redundant parent15-second and iframe60-second schedules. Hidden iframe performs no periodic workspace read. Concurrent read-only triggers share a promise; mutation reads remain independent, with an epoch preventing an older result or obsolete failure from overwriting a later result. Native download preparation and expiry handling remain unchanged.

Five focused scenarios pass. Existing regression:37/47 pass,10 fail. Original5b0fe72 with identical tests:32/42 pass, the same10 fail. The five focused tests account for the difference; no new failure. Existing failures include a native-download fixture still returning the retired token response, one incomplete Wix Data remove stub, and eight historical tracking/copy/style assertions. Raw outputs remain under root handoff/two-site-closeout-20261102. They are unresolved test maintenance, not counted as passed.

Protected original paid PO locks, stock, customer identity, quotation, order quantity, download URL delivery and financial records are not changed. GitHub, Wix and public verification are separate remaining stages.
