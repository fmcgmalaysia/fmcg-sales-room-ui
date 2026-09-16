# Buyer Room / Catalogue

Buyer-facing product discovery, brand browsing, and selection before any order is placed. This is **not** the Sales Room.

## Editable Wix Studio source

| File | Wix component |
| --- | --- |
| [`wix/catalogue-header-v2.html`](wix/catalogue-header-v2.html) | Catalogue header `#html3` |
| [`wix/catalogue-mega-menu-v3.html`](wix/catalogue-mega-menu-v3.html) | Mega menu `#html4` in the unpublished Wix draft; interaction testing pending |
| [`wix/catalogue-sidebar-v1.html`](wix/catalogue-sidebar-v1.html) | Left sidebar `#html5` |
| [`wix/catalogue-page-v3.js`](wix/catalogue-page-v3.js) | Catalogue page logic synced from Wix IDE to the unpublished editor draft |

The design, incomplete CMS work, and publishing checks are in [`design-handoff.md`](design-handoff.md).

## Existing public paths retained

- Root `../../catalogue-sidebar-v1.html` is an older compatibility file; it is **not** the current editable source above.
- Root `../../assets/banner-*.webp` and `../../assets/logo-orange-{white,black}-no-slogan.png` are Catalogue assets. They stay in the shared public `assets/` path so existing URLs are not broken.

The menu and page code are staged in Wix, but principal logos and live selection counts still require CMS data and an authorized end-to-end test. Do not publish this branch as a finished Catalogue.

