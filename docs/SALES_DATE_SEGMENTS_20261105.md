# Sales Review date segments

The user reported that the new text date box allowed `233032` to remain unformatted. The preceding Sales release changed the visible date format but omitted input assistance. This patch adds segmented DD/MM/YY editing to that same field; it does not change the planning API or date storage.

Baseline: Sales runtime `2df9ee1b`, Pages run343/41871970953; all96 public hashes matched, five retired resources returned404, both Wix sites confirmed published/live, and the original seven deployment rules were restored. The user-opened formal Sales tab51431644 ran the new version and displayed FOOD before NONFOOD in802 Review. That page contains the user's unsaved invalid date; it has not been discarded or refreshed. Overall original task acceptance remains open while this feedback is repaired and the other formal views are checked.

Scope: one Sales HTML, one Wix version token, one isolated static scope. Click selects DD; two digits advance to MM then YY. Slash characters remain. Arrow keys, Tab/Shift+Tab, Home/End, deleting segments, selecting all and six-digit paste are supported. Empty template returns to blank on blur. Existing readonly/financial/planning guards remain. Invalid dates still cannot pass the existing ISO save boundary. No automatic business save is added.

The local Chrome candidate verified DD selection, automatic advance after23, completed23/08/26 and the original save. Four new scenarios cover focus, segments, editing, readonly, paste/autofill and calendar validation. The frozen96-resource package changes only Sales index;95 assets including Buyer and shared history are unchanged.

Code: candidate. Pages/Wix/public acceptance: pending. No order, shipment date, payment or stock was written in production. Source of the user demonstration remains on its original tab.
