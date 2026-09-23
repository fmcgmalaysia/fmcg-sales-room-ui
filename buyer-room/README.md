# Buyer Room

Private procurement workspace for approved buyers. This is distinct from the internal Sales Room.

- Published-compatible pages: [`../buyer-room.html`](../buyer-room.html) and [`../buyer-login.html`](../buyer-login.html). Their root URLs must stay unchanged.
- Product discovery and selection: [Catalogue](catalogue/README.md).
- Current shared asset: `../assets/logo-orange-white-cropped.png` (referenced by `buyer-room.html`).

Order and account data remain controlled by Wix. The Catalogue can send a buyer into this workspace, but it is not a Sales Room page.

## Per-customer selection allowance

Create a Number field with key `selectionLimit` in Wix CMS collection `WixCustomers`. New customers are explicitly created with a 100-product allowance. In Sales Room, ADMIN or SUPER ADMIN sets 100, 300, 500, or 700 under My Customers → Manage Account. The authorized backend method `updateSalesRoomSelectionLimit(customerId, limit)` validates both the admin role and the four allowed values and writes a customer-profile audit record. Older customers without a configured value default to 100; existing customers with a saved 300-product allowance keep it. This allowance counts active selections; removed history does not count. If an admin lowers an allowance below the existing active count, existing products are preserved but new selections/restores are blocked until the count is below the new limit. Buyer Room displays the effective allowance returned by the backend, and Catalogue and Restore both enforce it server-side. Catalogue's future redesign should show a clear over-limit explanation when the buyer attempts to add another product, with a direct path to My Selection; the popup's layout and interaction are deliberately deferred.

Order Form QTY edits update `qtyEditedAt` and `qtyEditedBy` in the `WixBuyerListItems` payload after a successful save. My Selection's `Selected By` is instead the original selecting actor (`selectedByName`); no name is inferred from unrelated subsequent edits. Older records with no selection actor display a dash.

Removed History keeps an item available for **Restore** for 30 days after `removedTime`. Once that period ends, Buyer Room hides it and Catalogue changes its action back to **Add to Selection**. Adding it again starts a fresh RFQ, checks the active selection allowance, and keeps the previous removal details in the CMS payload for audit. Removed History has no Google Sheets or Excel actions; Excel export is available only on Current Selection. Expiry is enforced when workspace or Catalogue data is read, and Buyer Room also updates an open tab when the 30-day mark passes.

## My Selection Excel export

`WixBuyerListItems` is the sole operational source for My Selection exports. Its CMS schema must include these top-level fields:

- `customerId` — Text
- `removed` — Boolean
- `ea` — Number

Create a regular compound index with `customerId` first and `removed` second. Catalogue copies `FMCGMALAYSIA.ea`, packing size and CBM per carton into the selection snapshot when **Add to Selection** succeeds. Quotation prices continue to be written into the same selection record.

The export button calls one authenticated backend method. It queries only the signed-in customer's records where `removed = false`, builds the `.xlsx` from those stored snapshots, uploads it to `/buyer-room-exports` in Wix Media, obtains a temporary download URL and directs the browser to that URL. The iframe no longer builds or transfers Base64 workbook data, and no workbook is prepared before the customer clicks.

## Desktop scrolling on the Wix Studio test site

The Wix Studio branding bar adds about 30 px above the Buyer Room section. With the section set to **Fit to screen**, this leaves a short outer page scroll alongside the embedded room's scroll on long views. The desktop CSS rule in [`wix/buyer-room-scroll.css`](wix/buyer-room-scroll.css) is mirrored in Wix IDE `src/styles/global.css` and reduces only the section containing `buyer-room.html` by 31 px. My Selection, Order Form, and Account then use the embedded page's scroll; short Removed History has no extra scroll distance. Wix still forces an empty outer scrollbar (`body { overflow-y: scroll }`) on the free test site, so the visual one-scrollbar goal is not yet complete. Recheck the offset when the site moves off the free Wix test domain.

## Account page and deferred user-management workflow

The Buyer Room Account page presents a read-only company profile and a read-only list of authorized users from `WixCustomers` and `WixCustomerUsers`. The primary user is labeled **Company Admin · Protected** and has no edit or remove control. The optimized handshake image is `../assets/buyer-account-partnership-handshake.webp`.

The **Add User** control currently opens the staged form for interface review only; **Save User** and **Remove Access** are disabled. Do not turn them into front-end-only mutations. When Sales Room customer-user editing is next modified, explicitly revisit the shared add/save/revoke workflow for ADMIN, the assigned salesperson, and the customer's primary account, including server-side authorization, audit history, and prompt reflection in Buyer Room Account. Also remind the owner of the separate deferred Catalogue limit explanation: the 101st item must be blocked on a 100-item plan, with a path to My Selection; Removed History does not count toward the limit. The Catalogue popup design itself remains deferred until the Catalogue redesign.

