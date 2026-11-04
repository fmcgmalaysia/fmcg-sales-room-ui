# Account workspace discussion draft

2026-10-17 MYT. Open `index.html` through the existing local preview server. These files are an isolated proposal, with synthetic data and no production integration. The production `account-room` files and financial backend remain unchanged.

## Page plan

| Page | Main responsibility | Source when implemented |
| --- | --- | --- |
| Dashboard | Outstanding request value, available cash, available loan headroom and funding gap; direct request entry | Current procurement handoff, chase events and reconciliation blockers |
| Payment Requests | Submitted requests only; request amount, purpose, submission time, customer ETA, notes, documents and payment progress | Existing shared PO submission, supplier files and financial records |
| Creditor | Final supplier INV, applicable CN, payments, refunds and applied supplier credit; separate legacy reconciliation | Existing PO finance and supplier credit records; no duplicate ledger writes |
| Debtor | Customer invoices, receipts, CN and debit notes; balances separated by currency | Existing customer account ledger and linked Sales documents |
| Bank & Cash | Traceable recorded balances and transactions; forecasts separately labelled | Bank accounts and balance-entry authority still to be agreed; no bank connection added |
| Transaction History | Fully reconciled closed transactions and original files; searchable immutable history | Existing archive gates, not merely the Fully Paid request state |
| Activity History | Who did what, when, on which request and why | Existing audited Account actions, without routine row-order noise |

## Workflow and boundaries

1. Purchase submits a saved payment request. Before Account takes ownership, Purchase can edit under the existing version checks.
2. Account explicitly selects Reviewing. This takes ownership and locks Purchase editing. Reviewing and final Finance Checked are different actions.
3. Account checks the current instruction, supplier identity, supporting PI or final INV, applicable CN, prior cash and applied credit. INV480 less CN50 yields430; already-included CN must not be deducted again.
4. Finishing document review does not mean a bank payment started. Processing is a separate explicit action. Unknown bank results block retry and return until reconciled.
5. Payment recording captures an already occurred bank result and proof; it does not execute a bank transaction. Partial payment leaves the balance; pay-slip availability turns green only when a proof is present.
6. A return to Purchase needs a reason and a clear bank state. The original submission, Account comments and action history remain traceable.
7. Fully Paid concerns the request. Final transaction closure also requires the authoritative settlement, required files and CN decision, resolved receiving exceptions, a valid Finance Checked and completed customer Sales Invoice under existing gates.

Legacy records with payments must not be silently presented as new unpaid requests. Use the existing REVIEW_LEGACY reconciliation path. Company, supplier, currency and source document identities remain separate. No automatic reclassification or financial migration is authorized by this draft.

## Visual approach

Reuse current Account and shared MASTER theme assets; compact 20px headings, Inter typography, blue-gray table headers and existing MASTER top bar. Green `#12883E` marks the corresponding completed item, orange a pending action, red a real unresolved problem. Waiting and Reviewing status capsules use the approved download gray. Amounts and quantities align right; request identity, supplier, customer and notes align left. Missing costs or balances are not invented as zero. Account interface copy is English only, including navigation, buttons, labels, status text, dialogs, notices and accessibility labels. This is the user-approved Account exception to the general bilingual workroom rule. Business names and user-entered records must not be mechanically translated.

## Demonstrated locally

- All seven page views open; desktop content has no horizontal overflow.
- Search count follows visible rows; no-result feedback appears and clearing restores rows.
- New request → Reviewing lock → document checklist → separate Processing confirmation → synthetic partial payment and proof → action history.
- Original INV480, CN50 and request430 remain distinct; synthetic100 payment leaves330.
- Company switch to GHR excludes NCT records.
- Demo reset restores the initial proposal. No fetch, postMessage, storage write, real upload, CMS mutation or bank transaction is used.

Still for discussion: exact page names and columns, default notification priorities, owner assignment and escalation policy, bank balance sources and permissions, debit and receipt entry ownership, final document viewer layout, and notification acknowledgement rules. This draft does not assert those production integrations are complete.

## Finance allocation overview (17 Oct revision)

Payment request identity combines PO number above the supplier full legal name. Dashboard, Payment Requests and Bank & Cash share one company-level funding summary, independent of list search and filters. All figures are explicitly synthetic MYR cents. Initial submitted requests6040 less paid1450 gives outstanding4590. Cash2700 minus operating reserve300 minus the identified unknown-payment reservation900 leaves1500 available. Loan limit5000 less utilized3000 leaves2000. Remaining unallocated requests3690 less available funding3500 gives funding gap190. The existing900 reservation is removed from both available cash and new allocation demand, preventing double counting. Document problems remain in obligations, expected collections are not cash, and fully paid requests contribute zero. Unknown company balances display a dash, never invented zero. Bank pages use the same funding snapshot. Production sources, bank eligibility and reservation mapping remain subject to agreement.

Recovery for this isolated draft revision: ae5a654. Production Purchase baseline remains untouched.

## Inline document collection (17 Oct revision)

Dashboard and Payment Requests task rows show PO, PI, DO, INV and CN directly before Pay Slip. Explicit synthetic file records drive each button: orange not received, green received, red replacement needed. File presence does not mean approval; CN is only required when applicable. The help and individual file buttons explain each condition. Missing pay slips have an orange Upload Pay Slip entry. Attaching the synthetic proof changes only proof availability and adds an activity event; amount and payment status remain unchanged. The resulting green Pay Slip button matches Purchase History's64x24px,5pxradius,#12883E role and opens the existing demo proof viewer. No real upload or production payment mechanism is introduced. Recovery draft4931dba.

## Finance planning direction (17 Oct revision)

Menus now read Financial Overview, Payment Plan, Accounts Payable, Accounts Receivable, Cash & Facilities, Transaction History and Activity History. Original internal view keys and financial handlers stay in place. Payment Plan keeps the request, paid balance, document buttons, proof and original-request entry, while showing date, amount and Cash/Loan source for each indicative instalment. The mock editor supports up to two instalments with validation against the unpaid request balance; blank lines clear the indicative schedule. No production scheduler or financial reservation is introduced. Saves are memory-only and audit the draft action without changing paid values, review stage, cash balance or loan utilization. Unknown, processing and paid requests cannot be rescheduled. Plans exceeding the remaining amount after a mock payment are flagged for review and excluded from projected totals.

Initial draft schedules total2830: cash1030 and loan1800. Not scheduled860, projected cash470 and loan headroom200. Outstanding4590 includes the separate unknown-bank reservation900; it is not double scheduled. Plan figures are explicitly unreserved forecasts and source deficits are displayed in red; plan edits never imply bank execution or credit approval. The MASTER typography, compact spacing and colour semantics remain unchanged. Recoverybc6e4bc.

## Compact payment review (17 Oct revision)

The original request detail presentation is now a compact640px Review Payment panel: status and short edit-lock indication, INV/PI minus CN equals net, requested/paid/to-pay figures, purpose and term, direct existing document buttons, notes only when present, and collapsed action history. Submission time and staff remain available in history. All original stage-dependent action markup, review and payment event handlers remain unchanged. Only the draft detail presentation changes; no backend or production changes. Recovery1f54534.

## Pay slip thumbs-up (17 Oct revision)

Available pay slips now use a28px circle with a white thumbs-up outline on MASTER green#12883E; pending orange upload entry stays unchanged. The same proof entry opens a compact file card with View and Download. The included synthetic SVG fixture is labelled DEMO ONLY and explicitly not proof of payment; it contains no supplier, bank, amount or personal data. Production Drive delivery is unchanged and not integrated by this prototype. Recoveryf2c023d.

## Green supplier document actions (17 Oct revision)

Available green PO, PI, DO, INV and CN entries now open the same compact View/Download file-card design as Pay Slip, with the correct document type and current PO/supplier context. The synthetic document-demo.svg is labelled DEMO ONLY, not a business document, and has no financial or personal data. Missing and replacement-needed entries keep their prior messages and do not offer a fabricated file. Existing Pay Slip viewer, payment state, review handlers and production file delivery remain unchanged. Recovery85e70ba.

## Payment records with amounts and proofs (17 Oct revision)

The orange entry now routes to Record Payment after Reviewing and document-review checks. A completed bank payment captures amount, payment date, Cash/Loan account, bank reference, sample proof, optional Purchase note, recorder and timestamp together. Each save appends an individual in-memory record; requested amount stays unchanged. Paid is recomputed from the record sum and balance/request status follow it. Green thumbs-up opens all payment records, each with its own View and Download, plus a next-payment action while eligible. Existing seed paid amounts have explicit matching synthetic historical records. Bank & Cash draws new rows from the same records; cash payments reduce cash and loan payments reduce loan headroom. No copying into production Purchase or separate ledger writes occurs.

Reject unreviewed, problem, unknown or fully paid requests, missing proof/date/reference/account, non-positive/over-balance/sub-cent amounts and duplicate references in the same company/account. This draft models one reference per recorded payment, not bulk-transfer allocations. Save ignores stale double-submit events after form closure. Original unknown-bank and return gates remain. Optional Processing remains separate from recording an already completed bank result. Indicative plans are not silently rewritten; plans exceeding the new remaining amount are flagged for review. All records remain in memory and reset with the demonstration. Production storage, shared Purchase readback, real proof upload, duplicate protection and bank integration still require a separate verified implementation. Recoveryb255c23.

Validation: isolated tests cover200cash+230loan against430, two retained proofs, cumulative430/zero balance/FullyPaid, proof/review gates, overpayment/duplicate rejection, account-specific funding and company isolation. Chrome exercised the original Reviewing/checklist path, first200partial/230balance, second230full/two distinct View+Download entries and retained timestamps.

## Supplier bank details candidate (17 Oct revision)

Create/Edit Supplier Company Info adds Bank Name and Account No. through the existing profile/save mechanism. Account numbers remain text with leading zeros; both fields may be blank for legacy suppliers, but one-sided entries are rejected. Blank fields retain the legacy profile version; populated bank changes participate in optimistic concurrency. Old clients omitting the new fields preserve saved banks. Saved-profile conflict comparison includes both fields.

Account shows the current synthetic recipient beneath the supplier name and in Review Payment, Payment Plan and Record Payment. Each new mock payment captures its own recipientBank snapshot. Historical records without a snapshot say Not recorded and never borrow the current account. Changing supplier details therefore does not rewrite payment history. File viewers/downloads, PO document content, customer/warehouse projections and existing payment/lock handlers are unchanged.

This is an isolated candidate based on243880c, not a live Account integration. Production release still requires verifying SharedSuppliers bankName/bankAccountNo text schema, fresh live comparison, minimum backend deployment, Pages/Wix synchronization and public acceptance. No real bank data was entered. The local supplier-bank-preview fixture writes only synthetic in-memory profiles. Validation:132 protected tests passed; Chrome save/reopen preserved001234567890. Separate Account checks verified immutable recipient snapshots and missing-history display.

## Recipient confirmation (17 Oct revision)

Record Payment requires one mutually exclusive recipient choice on every new payment: Supplier account confirmed or Other account. Neither is preselected; Save Payment remains disabled until selected and the save handler independently checks it. Missing supplier bank details disable the supplier choice. Other account needs no reason and saves recipientChoice=OTHER with recipientBank=null; payment history explicitly says Other account. Supplier confirmation saves the current bank snapshot with recipientChoice=SUPPLIER. Existing records retain their prior snapshot or Not recorded. Document review now confirms supplier details; recipient bank confirmation occurs per payment.

Recovery66e7695. Scope is this local synthetic Account draft only. Five behavioural tests cover missing selection, two instalments, snapshot preservation, missing bank, duplicate/overpayment/proof gates and legacy records. Chrome verified radio exclusivity, disabled Save, repeated confirmation,200supplier+230other=430fullypaid, two proofs and missing-bank option availability. No actual transfer, production data integration, Pages deployment or Wix publication.

## Payment form and multiple local PDF proofs (17 Oct revision)

Paid Amount is a decimal text input, initially empty with a pale0.00 placeholder. Focus hides the placeholder; blur formats valid input to two decimals; Enter blurs without saving. Date, payment account, recipient choice, positive within-balance amount and at least one proof are required. Bank Reference and Note to Purchaser are optional. Empty references do not collide; provided duplicate references still reject. Payment account starts unselected. Note placeholder explains Purchase will see the message.

The orange upload icon selects multiple PDFs up to3MB each, matching the existing document-service type/size contract. This draft reads local PDFs into browser-memory blob URLs; filenames open View, saved records also offer Download and additional attachments. Deletion is allowed by uploader ID or SUPER ADMIN in the demonstration policy; deleted metadata is retained while the view URL is removed. Deleting proof does not delete or recompute payment amounts, and all-proof removal returns the proof indicator to pending. Replacement attachments remain possible on a fully paid record. Nine behavioural tests and Chrome multi-file/save/optional-reference/delete/amount-Enter checks pass.

Recoverya054398. This is not a Google upload or security boundary: client-only roles are demonstration data. Existing Apps Script UPLOAD supports PAYMENT in ACCOUNT_ROOTS, but TRASH currently excludes PAYMENT and validates PURCHASE_ROOTS. Real deletion requires a separate fresh live audit and minimal authenticated Account backend/document-service integration, upload ownership metadata, journalled unlink/trash receipt and public acceptance. No live backend/file/folder writes or Pages/Wix publish occurred.
