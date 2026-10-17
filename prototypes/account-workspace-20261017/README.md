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
