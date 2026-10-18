# Account production adaptation candidate

Real Account projection and existing authenticated saves remain authoritative. No synthetic records or example cash balances are used by account-room.

- Seven English finance views; compact Purchase-style PO, supplier, bank and document controls.
- Cash Available, Loan Available and Funding Gap show Not set, per user clarification.
- Two planned instalments are stored separately from actual payments; planning does not reserve money, transfer funds or change reconciliation.
- Existing payment upload, audit, retry, company isolation and financial exception paths remain in place.
- Shared stock UI uses English literals only in Account; other rooms retain their original labels and handlers.
- Recovery: live code and assets freshly matched 4a167459248c111757db1274e3adc76fb87423bc. Exact copies retained in root handoff/purchase-account-closeout-20261017.
- Validation: 152 focused tests pass; complete suite 523/526 with the same three failures reproduced on baseline 5434fc9 (names test fixture missing binding, instalment status expectation, English customer feedback expectation).
- Browser candidate: real Account iframe in isolated local fixture; funding Not set verified, payment amount 65 becomes 65.00 and Enter blurs. No production payment writes.
- Publication pending: GitHub Pages, Wix synchronization/publish and public verification have NOT completed.

2026-10-18 resumption: runtime e5b2c9b is on Pages, run 39003174566 succeeded; 25 actual public assets match exactly, including root Sales/Buyer pages and all current Purchase/Account/shared runtime assets. Two assumed directory index paths returned 404 and are not production entry points. Temporary branch policy 63342824 was removed after the user's explicit approval; original seven policies restored. Wix four backend modules and two page pointers were minimally patched and exactly read back in the preceding session. Apps Script active deployment is immutable v5, same endpoint and access configuration; two SharedSuppliers text fields added with no sample bank values. Fresh Wix editor is Loading; real Account source points to the new version but the embedded content is empty, without captured errors. One clean reload each did not restore it. User manual refresh requested. No complete Wix publication claim or real payment acceptance, and no main merge.
