# Account workspace discussion draft

2026-10-17 MYT. Open `index.html` through the existing local preview server. These files are an isolated proposal, with synthetic data and no production integration. The production `account-room` files and financial backend remain unchanged.

## Page plan

| Page | Main responsibility | Source when implemented |
| --- | --- | --- |
| Dashboard | New requests, purchase reminders, real problems and work in progress; direct task entry | Current procurement handoff, chase events and reconciliation blockers |
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
