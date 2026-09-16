# Buyer Room / Catalogue

Buyer-facing product discovery, brand browsing, and selection before any order is placed. This is **not** the Sales Room.

## Editable Wix Studio source

| File | Wix component |
| --- | --- |
| [`wix/catalogue-header-v2.html`](wix/catalogue-header-v2.html) | Catalogue header `#html3` |
| [`wix/catalogue-mega-menu-v3.html`](wix/catalogue-mega-menu-v3.html) | Proposed mega menu `#html4` |
| [`wix/catalogue-sidebar-v1.html`](wix/catalogue-sidebar-v1.html) | Left sidebar `#html5` |
| [`wix/catalogue-page-v3.js`](wix/catalogue-page-v3.js) | Proposed Catalogue page logic; not yet applied in Wix IDE |

The design, incomplete CMS work, and publishing checks are in [`design-handoff.md`](design-handoff.md).

## Existing public paths retained

- Root `../../catalogue-sidebar-v1.html` is an older compatibility file; it is **not** the current editable source above.
- Root `../../assets/banner-*.webp` and `../../assets/logo-orange-{white,black}-no-slogan.png` are Catalogue assets. They stay in the shared public `assets/` path so existing URLs are not broken.

The draft mega menu, principal logos, and live selection counts require Wix CMS/page-code integration before publication. The Wix draft currently retains the old working menu. Do not publish this branch as a finished Catalogue.

