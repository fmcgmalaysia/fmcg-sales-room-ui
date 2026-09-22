# Buyer Room data rollout

The code in this checkout is a local draft pending coordinated publication. On 22 September 2026, the required CMS fields and indexes below were created on the Wix test site, and the 2 existing test orders and their 2 lines were updated. The 50 existing test selections remain in CMS without a top-level `customerId` and are hidden by the new customer-scoped query.

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

## Publish checks

1. Confirm the 3 customer/order indexes are active in Wix CMS. Their definitions were saved on 22 September 2026.
2. Confirm the 2 old order headers and lines still have their new fields. Their changes were saved on 22 September 2026. The 50 test selections can remain dormant for this rollout.
3. Publish the coordinated backend, Wix page, and embedded Buyer Room HTML changes together. Explain the planned changes to the user before this step.
4. Test customer Catalogue to Buyer Room identity, an empty My Selection, Catalogue Add to Selection, 100 item limit, a confirmed order, Order History pages/details, and Sales Room incoming order detail.
5. Check that retrying a failed Buyer Room order with the same request ID creates one header and the expected number of lines.

The only data migration needed for this test site is the 2 old order headers and 2 lines. There is no reason to copy millions of historical rows into a new collection now. The remaining global Sales Room dashboard aggregation should be measured separately before customer volume grows; the current change does not claim that dashboard is ready for millions of active records.
