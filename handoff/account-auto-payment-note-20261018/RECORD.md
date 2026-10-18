# Automatic payment note — 2026-10-18

Single objective: generate requested amount, this payment, paid against request and balance due as note text, retaining an optional staff note. Only Record Payment is enhanced; refund, DO, proof addition, financial calculations, backend journal, permissions and file delivery are unchanged. Uses existing requestAmounts projection (including post-request refunds and applied credits); absent amounts remain Not set. Excess above current balance is explicit, never silently called a negative amount due. The existing backend still validates amount/version and saves reason through the original payment/audit note fields. No bank transaction is executed.

Recovery runtime6b6efae and existing b1e02fd baseline. Fresh complete live Account entry equals repository; current35 deployed frontend assets were compared exactly before editing. Original Account code saved privately. Minimal frontend additions plus one script cache token and Wix version pointer; no backend changes. Optional note maxlength1500 preserves room for generated text under the existing2000 limit.

Four meaningful tests cover partial/later payments, credits, refunds, unknown amounts and excessive payments. Chrome isolated actual-settlement frontend shows500 requested,300 payment,200 due and preserves additional note in the saved sample request. Test attachment is synthetic and no production save or payment was submitted. Private preview and evidence are excluded from production.

Release pending. Main remains unchanged. Whole-day closure still requires Sales/Buyer fresh public acceptance from the Warehouse integration release.
