# Buyer Room data rollout

Published to GitHub Pages and the Wix test site on 23 September 2026. The required CMS fields and indexes were created on the Wix test site on 22 September, and the 2 existing test orders and their 2 lines were updated. The 50 existing test selections remain in CMS without a top-level `customerId` and are hidden by the new customer-scoped query.

## Minimal CMS fields

Create these fields with the **exact field IDs** shown. Keep the existing `title` and `payload` fields.

| Collection | New fields and Wix types | Main index |
| --- | --- | --- |
| `WixBuyerListItems` | `customerId` Text, `removed` Boolean, `qdSyncStatus` Text | `customerId`, `removed` |
| `WixBuyerOrders` | `customerId` Text, `orderId` Text, `orderSortKey` Text, `status` Text, `isComplete` Boolean | `customerId`, `isComplete`, `orderSortKey` |
| `WixBuyerOrderLines` | `customerId` Text, `orderId` Text | `orderId` |
| `WixOrderAudit` | No new fields | No index needed |

Add a second `WixBuyerListItems` index on `removed`, `qdSyncStatus` only if the routing queue becomes slow. Existing `WixCustomerUsers` and `StaffMaster` member/email fields should be indexed when their row counts justify it. Avoid speculative indexes.

## Existing test data

The user authorized clearing the 50 test selections, but deletion is not required for this rollout. They have no top-level `customerId` and therefore do not appear in the new customer-scoped selection query. If a buyer adds one of those products again, Catalogue finds the existing record by title, fills the new fields, and requests a fresh quote. This avoids a separate CMS deletion and any orphaned QD rows. The 50 test records can be cleaned up with the 30-day removed-history work.

Keep the 2 existing test orders visible until their purpose is settled. Before publishing, fill their new header fields from each payload: `customerId`, `orderId`, `status`, `isComplete=true`, and `orderSortKey=<confirmedAt>|<orderId>`. For each of their 2 order lines, fill `customerId` and `orderId`. The header `lineCount` is also needed in the JSON payload for the count shown in Sales Room and Order History. Verify the 2 orders and their lines from the customer account after publication.

## Release verification

- Published GitHub `main` at `17dff36feb0b8b1544394ccd16ae2f9bad69deab` and Wix test site. The live Buyer Room embeds `buyer-room.html?v=20260922-buyer-scale`.
- OPOPO customer identity and Account display loaded correctly. My Selection showed 0 initially. A Catalogue `I NEED QUOTE` test added one product, which appeared in My Selection; Order Form showed it as unavailable for quantity entry until quoted.
- OPOPO Order History correctly showed 0. The 2 migrated test orders belong to customer `CUS-260920-025922` (TESTING 88), and their Wix CMS headers visibly contain `customerId`, `orderId`, `orderSortKey`, `status=CONFIRMED`, and `isComplete=true`.
- Removed History hid prices and export controls. It still says 90 days; changing the retention period to 30 days remains a separate task.
- Local test passed for a 1,025-row paginated history and repeated order submission with the same request ID. A live confirmed order and Sales Room incoming-order detail were not exercised because there is no quoted test product ready to order.

The only data migration needed for this test site is the 2 old order headers and 2 lines. There is no reason to copy millions of historical rows into a new collection now. The remaining global Sales Room dashboard aggregation should be measured separately before customer volume grows; the current change does not claim that dashboard is ready for millions of active records.

