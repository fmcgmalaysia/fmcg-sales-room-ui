# Buyer Room

Private procurement workspace for approved buyers. This is distinct from the internal Sales Room.

- Published-compatible pages: [`../buyer-room.html`](../buyer-room.html) and [`../buyer-login.html`](../buyer-login.html). Their root URLs must stay unchanged.
- Product discovery and selection: [Catalogue](catalogue/README.md).
- Current shared asset: `../assets/logo-orange-white-cropped.png` (referenced by `buyer-room.html`).

Order and account data remain controlled by Wix. The Catalogue can send a buyer into this workspace, but it is not a Sales Room page.

## Per-customer selection allowance

Create a Number field with key `selectionLimit` in Wix CMS collection `WixCustomers`. New customers are explicitly created with a 100-product allowance. In Sales Room, ADMIN or SUPER ADMIN sets 100, 300, 500, or 700 under My Customers → Manage Account. The authorized backend method `updateSalesRoomSelectionLimit(customerId, limit)` validates both the admin role and the four allowed values and writes a customer-profile audit record. Older customers without a configured value default to 100; existing customers with a saved 300-product allowance keep it. This allowance counts active selections; removed history does not count. If an admin lowers an allowance below the existing active count, existing products are preserved but new selections/restores are blocked until the count is below the new limit. Buyer Room displays the effective allowance returned by the backend, and Catalogue and Restore both enforce it server-side. Catalogue's future redesign should show a clear over-limit explanation when the buyer attempts to add another product, with a direct path to My Selection; the popup's layout and interaction are deliberately deferred.

Order Form QTY edits update `qtyEditedAt` and `qtyEditedBy` in the `WixBuyerListItems` payload after a successful save. My Selection's `Selected By` is instead the original selecting actor (`selectedByName`); no name is inferred from unrelated subsequent edits. Older records with no selection actor display a dash.

