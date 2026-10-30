# Supplier source confirmed-save feedback

Authorized overnight UX optimization, separately scoped from active-only routing and backend receipt recovery. Existing project framework, supplier-allocation controller, draft tests and actual assembled save/readback path were inspected. Fresh public supplier-allocation.js exactly matched the repository before editing; preserved privately in root handoff/master-save-recovery-20261030/live-supplier-allocation.js. Existing staged app already refreshes quietly after a save, and must be preserved instead of replacing it with raw app.js.

Problem: after an authenticated success receipt, controller state marked the source saved but left its visible status as Saving until the next full workspace read. A delayed read therefore looked like a write still in progress.

Minimum change: immediately paint the specific source's confirmed status and saved button, without rebuilding/reopening its dialog or moving focus. Keep fresh workspace/version verification before a following write; keep all other drafts and original pending identities. Ambiguous/failed saves never enter this path. No backend, quantity, money, Finance lock, request protocol, polling or inventory change.

Thirty-seven relevant tests pass. Added scenarios cover success before readback, no duplicate save while awaiting fresh versions, retained other-source draft and a closed dialog staying closed. Source-only candidate; GitHub synchronization follows. No Pages, Wix or public release claimed. Production remains on the existing public resource package until separately released.
