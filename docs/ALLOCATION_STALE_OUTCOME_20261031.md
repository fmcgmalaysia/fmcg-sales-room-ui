# Terminal outcome for stale prepared allocations

If an allocation fails before its business event is inserted and stock changes before retry, the existing prepared request must end with a durable rejection. It must not keep throwing a transport-shaped error or execute against the obsolete version.

The allocation writer now returns an unsuccessful, nonretryable result only after confirming that its business event is absent and the current allocation version differs. The existing journal preserves that result. If the business event already exists, original exactly-once recovery stays unchanged. A new allocation still requires a fresh version and a new user confirmation.

The Wix Purchase bridge forwards a terminal checked result to the existing PURCHASE_SAVE_RESULT failure handler using the original save identity, while retaining the ordinary check response. This also handles reopening after a lost rejection acknowledgement. It does not change static frontend assets, original failure handling, quantities, locks, authorization or storage.

Fresh plannerAllocation matched the repository. Fresh Purchase page matched the exact prior published purchase-page-draft.js retained by quantity-style release; its current version token is preserved. The checkout's historical token is not deployed over it. Recovery is stock ownership6a27ab1 / recordc95bc2b, with current99 assets untouched. Independent live receipt patchfc76b37 remains protected.

Validation: original stale-request test fails; after patch14 allocation checks pass,71 related regression checks pass. Two current-release UI handler checks verify terminal failure releases the pending request without success feedback, while genuinely unknown processing stays pending. Publication pending.

Unresolved hard termination boundary: a persistent company lock cannot safely be deleted by age alone. An older writer could resume after a replacement starts; existing allocation commits lack a conditional fence for that replacement. This patch deliberately does not claim automatic orphan-lock recovery. Such a change needs a separate concurrency design and regression of every shared journal consumer. No production orphan lock has been observed or cleared.
