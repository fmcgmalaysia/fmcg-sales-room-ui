# Automatic payment note — 2026-10-18

Single objective: generate requested amount, this payment, paid against request and balance due as note text, retaining an optional staff note. Only Record Payment is enhanced; refund, DO, proof addition, financial calculations, backend journal, permissions and file delivery are unchanged. Uses existing requestAmounts projection (including post-request refunds and applied credits); absent amounts remain Not set. Excess above current balance is explicit, never silently called a negative amount due. The existing backend still validates amount/version and saves reason through the original payment/audit note fields. No bank transaction is executed.

Recovery runtime6b6efae and existing b1e02fd baseline. Fresh complete live Account entry equals repository; current35 deployed frontend assets were compared exactly before editing. Original Account code saved privately. Minimal frontend additions plus one script cache token and Wix version pointer; no backend changes. Optional note maxlength1500 preserves room for generated text under the existing2000 limit.

Four meaningful tests cover partial/later payments, credits, refunds, unknown amounts and excessive payments. Chrome isolated actual-settlement frontend shows500 requested,300 payment,200 due and preserves additional note in the saved sample request. Test attachment is synthetic and no production save or payment was submitted. Private preview and evidence are excluded from production.

Release pending. Main remains unchanged. Whole-day closure still requires Sales/Buyer fresh public acceptance from the Warehouse integration release.


Release completed: note code44bedcd normally merged with the prior Warehouse mobile Sign in/cache fix, final static runtime1d83c0118c38c3384b3cea4b20f6d1dab5643744. PR189 remains draft; main unchanged. Pages39115658496 success and35 public frontend assets exact. Temporary policy63453405 removed immediately; original7 IDs/names/types exact. Earlier133b49f run39115302994 and policy63453036 also finished/restored. The same already-authorized branch was used for the necessary dependency cache correction, with no wider access.

Fresh complete Account Wix candidate equals repository, only its version pointer changed; Wix Studio published/live receipt captured. User-restored real Account page points to auto-payment-note-v1, opens original Record Payment and shows Automatic payment summary plus optional Additional Note to Purchaser. A0.01 unsaved input produced honest Not set payable/balance and a0.01 preview; it was cancelled, never saved. Isolated sample verifies500/300/200 and retained staff note. No relevant public console errors.592 tests589 pass/same3 baseline failures. All four publication stages complete. Warehousev2 public and Source Sales/Buyer compatibility acceptance also completed; no real goods or payment transaction was fabricated.

User's latest Committed Qty question remains design discussion only. Current Buyer/Sales display basis differs; proposed consistent promise/procurement/shipped rules require a separately scoped quantity change, not an automatic extension of this note patch.
