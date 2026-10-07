# FMCG Malaysia web interfaces

Latest 2026-10-07 status and exact live-source archive: [day closeout report](handoff/room5-day-closeout-20261007/REPORT.txt). Addition code a1f2b49 is installed for testing; independent acceptance and Wix request stability remain pending. Excel work is explicitly paused. Do not deploy this documentation branch or old main as a site recovery.

This repository contains two separate workspaces. Its historical GitHub name, `fmcg-sales-room-ui`, does **not** mean that Buyer Room or Catalogue changes belong to Sales Room.

| Area | Audience and purpose | Source / existing entry point |
| --- | --- | --- |
| [Sales Room](sales-room/README.md) | Internal sales and customer operations | Root `index.html` (existing public URL preserved) |
| [Buyer Room](buyer-room/README.md) | Approved buyers' private procurement workspace | Root `buyer-room.html` and `buyer-login.html` (existing public URLs preserved) |
| [Buyer Room / Catalogue](buyer-room/catalogue/README.md) | Buyer-facing product discovery and selection | `buyer-room/catalogue/wix/` for Wix Studio source; root `catalogue-sidebar-v1.html` remains a legacy compatibility file |

The root `assets/` directory remains at its existing URL because both workspaces already reference files there. Each asset's ownership is listed in the area README. Do not move a root HTML page or a referenced asset merely to make the folders look tidy: that would change GitHub Pages URLs used by Wix.

Wix owns authentication, product CMS, access controls, and publication. Source files here are **not** the live Catalogue until explicitly applied and published in Wix Studio. No Catalogue change should be treated as a Sales Room change.

