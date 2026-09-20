# Sales Room independent QD release

## Decision

- One Wix customer owns one Google Sheets Quotation Desk file.
- The complete approved template is copied into the `QUOTATION DESK` Drive folder.
- A salesperson is assigned to the customer, but the customer QD is no longer a tab inside a salesperson-owned workbook.
- Customer and catalogue access stays `PENDING` until the copied QD has been activated and verified.

## Creation flow

1. Sales Room validates the customer form and creates the permanent `CUSTOMER ID`.
2. Wix creates the `WixCustomers` and primary `WixCustomerUsers` records in a pending state.
3. Wix calls the Apps Script web app with `CUSTOMER ID`, company name, currency and assigned staff ID.
4. Apps Script copies the whole QD template. A whole-file copy preserves formulas, formatting, validation, protected ranges, hidden rows and the bound spreadsheet script.
5. Apps Script writes the customer identity to `WIX QUOTATION`, attaches developer metadata and returns `ACTIVATION_REQUIRED`.
6. Sales Room shows **Open QD setup**. The salesperson clicks **Allow access** once in `QD SETUP!B9`.
7. **Verify & activate** checks the connection and the copied template. When valid, Apps Script hides `QD SETUP`, opens `WIX QUOTATION` and returns `READY`.
8. Only then does Wix activate the customer's authorized users.

## SORT NO.

`SORT NO.` is never copied as a fixed value by Apps Script. Both `WIX QUOTATION` and `DRAFT 草稿区` keep their hidden-row formula and read the current value from Point Base by barcode. Moving a product in Point Base therefore changes the QD sort order without rebuilding the QD.

## Idempotency and recovery

- The factory scans the destination folder for developer metadata matching the `CUSTOMER ID` before making a copy.
- Retrying customer creation cannot create a second QD for the same customer.
- A failed activation remains recoverable from Sales Room; it does not require recreating the customer.
- `QD SETUP` remains visible until verification succeeds.

## Status contract

- `PENDING`: Wix customer record exists; QD request has not completed.
- `ACTIVATION_REQUIRED`: independent QD exists and awaits the one-time Google connection.
- `READY`: copied template verified and customer users activated.
- `ERROR`: provisioning failed; retry is allowed and remains idempotent.

## Release files

- `../index.html` — Sales Room interface and activation controls.
- `google-apps-script/WebAppRouter.gs` — authenticated request router.
- `google-apps-script/WixQdFactory.gs` — copy, verify and activate service.
- `wix/onboarding.web.js` — Wix CMS orchestration and access-state rules.

The Apps Script deployment keeps the existing `NCT_ONBOARDING_SHARED_SECRET`. The Wix backend secret name remains unchanged.

## Customer lifecycle and access

Customer management uses the existing `WixCustomers` and `WixCustomerUsers` collections. No separate archive or suspension collection is required.

`WixCustomers` adds these operational fields:

- `lifecycleStatus`: `ACTIVE` or `ARCHIVED`.
- `accessStatus`: `PENDING`, `ACTIVE`, `SUSPENDED` or `BLOCKED`.
- `reactivationStatus`: `NONE`, `REQUESTED`, `APPROVED` or `REJECTED`.
- Reasons, staff identity and timestamps are stored in the existing `CustomerProfileAudit` collection instead of being duplicated in the customer record.

The three status dimensions are intentionally separate. Archiving never deletes the customer, QD, confirmed orders or audit history. Suspending blocks Catalogue access immediately while Buyer Room can remain available in restricted account mode. Only Admin and Super Admin can suspend, archive, restore, approve or reject reactivation.

Sales Room provides four compact customer views: **Active**, **Suspended**, **Reactivation** and **Archived**. The last two views and all account-state actions are Admin-only. Every account action is written to `CustomerProfileAudit`.
