# Sales MASTER receipt recovery — candidate 2026-10-19

Objective: repair a transferred Sales order left in Order Management after a 504 response. Read the authenticated immutable MASTER receipt using the exact saved submission; finalize the existing Sales transfer without replaying intake.

Recovery: parent bee202b; runtime 47bf37d; verified/department-ui-before-20261018. Exact fresh Wix source snapshots and hashes are preserved privately under C:/FMCG-WIX-LOCAL/handoff/sales-master-receipt-recovery-20261019/. All six relevant live code components matched repository source before changes. Wix draft readbacks match candidate source after isolated changes.

MASTER receipt lookup reads PREPARED and ACCEPTED activities only. It validates submission identity, payload hash, task IDs, company and timestamp. No task, cost, order or activity mutations. Source reconciliation uses existing authorization, accepted audit, transferred-state writer and own-lock release. Unaccepted receipts remain pending. No resubmission and no cost recapture.

Validation: 51 focused intake, receipt, delivery, NCT/GHR cross-site, feedback and review-loading tests pass. 70 shared regressions: 63 pass, seven failures reproduced unchanged on parent bee202b (historical UI assertions); baseline output retained in private handoff. JavaScript syntax and whitespace checks pass.

Release pending: GitHub Pages, Wix publication and formal Sales recovery acceptance. Do not treat draft synchronization as publication. Never merge into main without user acceptance. Preserve current Purchase tasks, supplier plans, costs and P.O. work.

Separate observation: supplier-allocation.js resets price fields on supplier selection/change. Thus zero fields in an allocation draft do not establish intake-cost failure or causation by 504. No allocation or cost logic changed in this patch.
