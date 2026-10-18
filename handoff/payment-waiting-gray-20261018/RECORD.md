# Two waiting-status pills

User requested gray with white text for `Awaiting Review` and `Waiting for Acc. response`. The neutral background is `#B8C4D0`, matching the existing disabled download control. Only these labels change; Reviewing Docs and other pending actions retain orange-white, completion remains blue, issues remain red.

Minimal presentation patch: expose the existing displayed status label as a data attribute in two render templates and add two scoped CSS rules. No status predicates, amounts, handlers, permissions, downloads, storage or backend changed. Version markers and the two Wix entry tokens are updated. No shared CSS changes, so Warehouse and Support assets remain exact.

Recovery: deployed runtime `da5c24b`, release record `d451dd9`; existing limited verified tag identified, without creating a new business-verified baseline. Six fresh public assets match the checkout and both fresh Wix entry-code readbacks match before editing. Exact snapshots remain in the private root handoff of the same name.

Validation: 116 existing Purchase UI checks pass. Source audit confirms the only JavaScript difference is two presentation attributes; all prior CSS declarations remain exact. Chrome uses the real Account renderer with explicit sample rows: both requested labels are gray-white, Reviewing Docs/Payment Processing remain orange-white, Fully Paid remains blue-white; all pills remain 16px. No production business writes.

Release: code complete; Pages deployment, Wix publishing and refreshed public verification pending. Main remains unchanged.
