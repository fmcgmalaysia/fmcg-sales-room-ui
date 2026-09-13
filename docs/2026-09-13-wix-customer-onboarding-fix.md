# Wix customer onboarding authorization fix

Date: 2026-09-13

Status: Published to the FMCG Malaysia Wix site

## Issue

Creating a new customer from Sales Room could fail before the request reached the onboarding workflow because staff authorization was being resolved through an incompatible backend web-method call.

## Resolution

- Staff identity and assignment routing are now resolved inside the onboarding backend from the authenticated Wix member and private staff data.
- The customer-creation endpoint remains restricted to signed-in site members.
- Sales ownership and quotation-desk routing continue to be decided on the server; browser-supplied staff identity is not trusted.
- RINN's active staff routing record and quotation-desk destination were verified.

## Verification

- The revised backend was synchronized with the Wix editor and published.
- A safe duplicate-sheet test reached the protected onboarding workflow instead of failing at web-method permission enforcement.
- The test stopped at the expected duplicate-sheet safeguard.
- Temporary Wix customer, user and audit records created during validation were removed.
- No test sheet was added to RINN's quotation desk.

## Recovery note

The exact published backend source snapshot is retained in the authorized local project workspace and is intentionally not stored in this public repository.
