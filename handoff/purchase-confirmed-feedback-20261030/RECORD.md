# Supplier source confirmed-save feedback

Authorized overnight UX optimization, separately scoped from active-only routing and backend receipt recovery. Existing project framework, supplier-allocation controller, draft tests and actual assembled save/readback path were inspected. Fresh public supplier-allocation.js exactly matched the repository before editing; preserved privately in root handoff/master-save-recovery-20261030/live-supplier-allocation.js. Existing staged app already refreshes quietly after a save, and must be preserved instead of replacing it with raw app.js.

Problem: after an authenticated success receipt, controller state marked the source saved but left its visible status as Saving until the next full workspace read. A delayed read therefore looked like a write still in progress.

Minimum change: immediately paint the specific source's confirmed status and saved button, without rebuilding/reopening its dialog or moving focus. Keep fresh workspace/version verification before a following write; keep all other drafts and original pending identities. Ambiguous/failed saves never enter this path. No backend, quantity, money, Finance lock, request protocol, polling or inventory change.

Thirty-seven relevant tests pass. Added scenarios cover success before readback, no duplicate save while awaiting fresh versions, retained other-source draft and a closed dialog staying closed. Source-only candidate; GitHub synchronization follows. No Pages, Wix or public release claimed. Production remains on the existing public resource package until separately released.

## Confirmed workspace readback, same feedback fault

Formal customer allocation tests reproduced a second part of the same confirmed-save feedback fault: the successful save starts a quiet workspace read, but the general edit guard discards it while supplier drafts are parked. A second scenario opens another form before the read returns; ordinary polling must still leave that form alone. No repeated write was used to refresh a list.

The assembled-runtime overlay marks only the read initiated by an authenticated successful save. That read can update its internal workspace and supplier-version verification while preserving open forms and inline drafts. The current table renders when no such form is being edited. Ordinary polling retains its existing edit guard; a newer pending write or cost retry still blocks the older response. Failed reads preserve the current task list and show the read failure. Exactly three static resources change: app.js, supplier-allocation.js and index marker;91others remain byte-identical to864322f.

Five focused readback tests first reproduce3failures on the shipped864322f runtime, then all5pass on the candidate. The assembled UI/source/split/web regression has148tests,145pass and the same3previously recorded baseline failures. Eleven supplier draft tests pass, including immediate confirmed feedback and no duplicate write before version readback. This candidate is not published; current production remains864322f with the separately published9518417 journal correction.
