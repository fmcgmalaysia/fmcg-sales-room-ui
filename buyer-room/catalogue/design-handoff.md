# Buyer Room / Catalogue design handoff — ZUS blue refresh

This branch contains the reviewed source for the Wix Studio Catalogue refresh. It does **not** publish or alter the Wix site. Authentication and product CMS remain in Wix.

## Design

- Deep royal-blue navigation with the tight, slogan-free orange/white `fmcgMalaysia.com` mark.
- Four navigation groups, left-aligned with closer spacing.
- Mega menu: scrollable subcategories at left; corresponding principals at right, 15 per page with arrows. Principal selection filters the product dataset.
- Left rail: photograph with copy overlaid first, then **My Product List** (explicitly not an order), Buyer Room, and finally Featured Brands. Wix Madefor Text/Display families are requested for embedded UI.
- Cards and backgrounds use a restrained off-white/blue palette, with orange only as an accent.

## Files

- `wix/catalogue-header-v2.html` — HTML component `#html3`.
- `wix/catalogue-mega-menu-v3.html` — proposed HTML component `#html4`.
- `wix/catalogue-page-v3.js` — proposed Catalogue page code.
- `wix/catalogue-sidebar-v1.html` — left-rail HTML source. The repository-root `catalogue-sidebar-v1.html` is retained for existing consumers.
- Repository-root `assets/banner-*.webp` — photographic banner assets, kept at the existing public path.
- Repository-root `assets/logo-orange-{white,black}-no-slogan.png` — transparent, tightly cropped logo variants, also kept at the existing public path.

## Wix integration to finish before publishing

1. The sidebar HTML component is `#html5`. Connect its `SIDEBAR_DATA` / `OPEN_BUYER_ROOM` messages to the Catalogue page. Until live buyer-list data is connected, the draft displays dashes instead of fabricated zero counts.
2. The product CMS contains `Principle` text and subcategory references. It does **not** currently have a principal-logo mapping collection. Create `PrincipleLogos` with `principle` (text), `logo` (image), and optional `featured` (boolean) fields, then add approved logo assets. Until then the menu shows name-only tiles. Do not use product-pack shots as brand logos.
3. Verify the product collection ID and field keys `FMCGMALAYSIA`, `principle`, `subCategories`, plus the actual Catalogue HTML element IDs in Wix Studio.
4. The revised Header and sidebar are in the Wix Studio draft; the old mega menu remains in the draft. Wix IDE opened blank and the Catalogue page-code pane was read-only, so the proposed mega menu and page code have **not** been applied. Test desktop/mobile, member access, search, category/principal filtering, Buyer Room, and product lightbox after IDE access is restored. **Publish only after owner review.**
5. Draft Header and banner image URLs temporarily point to the `catalogue-zus-blue-refresh` GitHub branch. Move them to approved Wix Media Manager URLs or a stable published asset path before publication.

The site-wide slogan placement remains a separate global-layout decision; it has deliberately not been appended to the logo or forced into the header.

