# Initial procurement reference — 2026-10-19

User authorizes first-row intake reference before supplier choice, retention on first supplier choice, blank additional source costs, and removal of the independent Cost Error interface. No backend, intake, storage, authorization, lock, quantity, saved cost, or history change.

Recovery parent 0c08dfc and limited annotated verified/department-ui-before-20261018. Fresh six affected public assets and both Wix entries matched repository before editing; exact private copies under C:/FMCG-WIX-LOCAL/handoff/purchase-reference-warehouse-dialog-20261019/. Wix source is not replaced; publication requires only a version token.

Intake already captures POINTBASE without supplier. Supplier selection previously cleared draft prices unconditionally. First root choice now retains the current exact prices; new supplier splits and supplier replacement retain the original reset behavior with unknown price inputs visibly blank. Before supplier choice root prices are visible but disabled; no save or reference request occurs implicitly. Existing supplier/reference locks and saved-source guards remain. Task-grid Cost Error badge and independent detail route are removed; normal Catch Cost feedback and backend error history remain. Existing shared cost-error CSS is also used by shortage controls and is retained.

Validation: 37 focused allocation/cost retry tests pass, including initial precision, new split, replacement and no implicit save. UI suite124/125 pass; the sole staff suffix assertion fails identically against the captured pre-change live app (expects ACTUAL STAFF / Purchase although the separately released header shows ACTUAL STAFF). This baseline mismatch is not changed. Shared intake/source/warehouse regression56/56 pass. Actual candidate frontend tested with isolated sample bridge; no business writes.

Release status: code candidate only. GitHub Pages, Wix publish and real public acceptance not completed. Do not call published or merge into main. Warehouse compact receipt is a separate stacked branch and PR. Broad SAVE speed and Chrome opening investigation remain unresolved/deferred.
