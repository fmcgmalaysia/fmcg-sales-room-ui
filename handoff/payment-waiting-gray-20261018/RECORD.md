# Two waiting-status pills

User requested gray with white text for `Awaiting Review` and `Waiting for Acc. response`. The neutral background is `#B8C4D0`, matching the existing disabled download control. Only these labels change; Reviewing Docs and other pending actions retain orange-white, completion remains blue, issues remain red.

Minimal presentation patch: expose the existing displayed status label as a data attribute in two render templates and add two scoped CSS rules. No status predicates, amounts, handlers, permissions, downloads, storage or backend changed. Version markers and the two Wix entry tokens are updated. No shared CSS changes, so Warehouse and Support assets remain exact.

Recovery: deployed runtime `da5c24b`, release record `d451dd9`; existing limited verified tag identified, without creating a new business-verified baseline. Six fresh public assets match the checkout and both fresh Wix entry-code readbacks match before editing. Exact snapshots remain in the private root handoff of the same name.

Validation: 116 existing Purchase UI checks pass. Source audit confirms the only JavaScript difference is two presentation attributes; all prior CSS declarations remain exact. Chrome uses the real Account renderer with explicit sample rows: both requested labels are gray-white, Reviewing Docs/Payment Processing remain orange-white, Fully Paid remains blue-white; all pills remain 16px. No production business writes.

Release completed 2026-10-18 MYT: runtime `140797c`, draft PR175. Pages run `39087853590` succeeded; all 30 MASTER assets match, with new Purchase/Account markers and unchanged Warehouse/Support assets. User explicitly authorized temporary branch policy `63427785`; removed after deployment and original seven exact rules restored.

Both Wix entry tokens were replaced individually; full readbacks match expected code with no other changes. Wix confirmed “This site is published and live online.” Formal Account shows two Awaiting Review pills and one Waiting for Acc. response pill at background rgb(184,196,208), white text, 16px height. Financial Overview and Payment Plan read successfully. Purchase initially had an empty iframe after tool refresh; the user reopened it, then actual Payment Follow-up confirmed the same neutral waiting background and white text. No relevant console errors in either public page. Public evidence and exact snapshots remain in the private root handoff.

No production business writes, no backend changes, no main merge, and no new business-verified baseline implied.
