# FMCG Malaysia web interfaces

This repository contains two separate workspaces. Its historical name, `fmcg-sales-room-ui`, does **not** mean that Buyer Room or Catalogue belongs to Sales Room.

| Area | Audience | Current GitHub files |
| --- | --- | --- |
| Sales Room | Internal sales team | [`index.html`](index.html) |
| Buyer Room | Approved buyers | [`buyer-room.html`](buyer-room.html), [`buyer-login.html`](buyer-login.html) |
| Buyer Room / Catalogue | Buyer-facing product discovery | Draft Wix sources in [`wix/`](wix/), Catalogue banner and logo files in [`assets/`](assets/) |

The root HTML pages and `assets/` paths are kept in place because Wix/GitHub Pages already reference those URLs. The Catalogue work in [draft PR #1](https://github.com/fmcgmalaysia/fmcg-sales-room-ui/pull/1) does not modify the Sales Room page. Wix owns authentication, CMS, and publication; GitHub source alone is not a published Catalogue.

The local working copy has additionally grouped the Catalogue Wix sources under `buyer-room/catalogue/wix/`. That source-folder move has **not yet been synchronized to this GitHub branch**; use the current links above when browsing GitHub. Do not merge or publish the draft as a finished Catalogue.
