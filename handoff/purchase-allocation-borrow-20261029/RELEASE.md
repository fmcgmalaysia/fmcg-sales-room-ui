# Customer allocation and borrowing release

Code commit: `39503390606d8e4840be83e036c1448cce3d008d`.
Build: `20261029-customer-allocation-v1`.
Draft PR: https://github.com/fmcgmalaysia/fmcg-sales-room-ui/pull/237
Recovery runtime: `6971fb1315f8ebc36f9814ce65ecb302f2db5397`, preserved 92-resource package. Main remains unchanged; no new user-verified baseline is claimed.

## Four publication stages

1. Code complete and synchronized to GitHub. Six Purchase static assets differ from the current baseline; the remaining 88 resources are identical. Final package resource hashes match the browser-tested package.
2. Pages workflow 40899277077 completed successfully for the pinned commit and `purchase-allocation-only`. All 94 public resources matched their expected SHA256; nine retired paths still return 404. Temporary branch policy 64805260 was removed immediately after successful deployment. All original seven rules were restored exactly.
3. Eight existing backend modules and the Purchase page were synchronized through 17 isolated changes. Two new private backend modules were added. All eleven full-source readbacks matched the candidate. Wix confirmed: “This site is published and live online.” Exact sources, publication screenshot and original recovery copies are retained in the private root handoff folder.
4. Public Purchase was opened through the original Chrome shortcut and hard refreshed with Ctrl+Shift+R. Its embedded URL carries the new build. TESTING 02's 200-carton row shows HONG LEA, net cost82.47, total16,493.76 and the original P.O. control; there is no duplicate source child. The pending100 row inherits neither source nor P.O. Both allocation buttons open their correct batch. Support, Warehouse and Finance data refreshes succeeded; Support Desk1→2→1 showed1→0→1 tasks. Warehouse correctly shows no currently authorized delivery tasks. No relevant console errors were captured. No production allocation, borrowing, receipt, invoice or Loaded transaction was submitted.

## Scenario behavior

- A250, own received200, free20 and eligible B280: the first dialog proposes200+20 and shortage30. The second dialog names B and30. Only final confirmation submits. The existing allocation journal atomically records A250/B250/free0 and outstanding responsibility30. Physical500 does not change.
- Lost acknowledgment or concurrent allocation: the existing request identity and journal protections prevent a second committed allocation or partial borrowing responsibility.
- A Loaded250: the existing physical outflow authority deducts once, to250. Allocation, invoice, repayment and archive do not add another deduction.
- New receipts: arrival alone does not clear borrowing. Explicit repayment restores the lender's allocation and clears the corresponding responsibility without an additional physical posting.
- Quarantined receipts: excluded cartons cannot be allocated. Reconciliation requires a reason, preserves receipt/exception/debt history and cannot reduce protected Loaded or invoice quantities.
- Existing production TESTING02 currently has no received CHIPSMORE cartons. Its200 and100 dialogs truthfully show reserved0/free0 and their respective shortages. The borrowing screen shows no eligible donor and offers no confirmation that would fabricate stock. A purchase plan of200 is not a receipt of200.

## Validation and limits

Scoped regression:374/375 pass. The sole failure is the unchanged Sales/Buyer wording assertion already present in the baseline. A separate old Sales split fixture failure was reproduced on the unchanged parent and is documented in IMPLEMENTATION.md; it is not counted as passing acceptance. Actual staged Purchase and protected Support/Warehouse browser scenarios passed, including seven Warehouse responses screened for financial fields. Source hashes were unchanged after testing.

First version selects one lender that can cover the remaining shortage per confirmation. Customers connected to an open borrowing responsibility cannot lend onward. Active Desk instructions and Loaded/invoice protections remain enforced. Loaded or invoiced returns and multi-batch source correction after Loaded require supervised review. Partial repayment can use free receipts; a newly received unmaterialized lender earmark must be confirmed as a whole. These restrictions do not create a second allocation or stock engine.

Automation-triggered Wix reload initially produced the previously observed blank embed; normal Chrome shortcut navigation followed by native hard refresh loaded the same new build successfully. The reload observation is retained separately from successful public acceptance evidence.

User business acceptance remains pending. Test TESTING02's200 and100 dialogs first, then use actual completed receipts for the A250 borrowing scenario. Do not merge this draft PR or create a verified production tag until the user confirms the real business workflow.
