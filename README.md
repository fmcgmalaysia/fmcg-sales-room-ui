# FMCG Malaysia web interfaces

Historical 2026-10-07 status and exact live-source archive: [day closeout report](handoff/room5-day-closeout-20261007/REPORT.txt). This archive is not the current release status. Do not deploy this documentation branch or old main as a site recovery.

This repository records two Wix systems, FMCGMALAYSIA and MASTER, with one shared GitHub Pages static deployment. The [system ownership and release boundaries](docs/SYSTEM_OWNERSHIP.md) define their responsibilities. Its historical GitHub name, `fmcg-sales-room-ui`, does **not** mean that Buyer Room, Catalogue or MASTER changes belong to Sales Room.

## Before starting a task

Read the project `AGENTS.md`, `START_HERE.md`, the current task handoff, and [SYSTEM_OWNERSHIP.md](docs/SYSTEM_OWNERSHIP.md) before editing or publishing. Confirm the actual checkout and branch, the owning Wix system, shared consumers, recovery evidence and acceptance scope. Use the task's release record and live evidence for version status; historical README notes and branch names are not deployment evidence.

In the local project `C:\FMCG-WIX-LOCAL`, the project root is not a Git checkout. If the current task branch lacks this document, read `handoff/system-boundaries-20261014/SYSTEM_OWNERSHIP.md` and `RECORD.txt` from the project root. That handoff preserves the GitHub document and its branch/commit reference; do not switch application branches merely to read it.

| Area | Audience and purpose | Source / existing entry point |
| --- | --- | --- |
| [Sales Room](sales-room/README.md) | Internal sales and customer operations | Root `index.html` (existing public URL preserved) |
| [Buyer Room](buyer-room/README.md) | Approved buyers' private procurement workspace | Root `buyer-room.html` and `buyer-login.html` (existing public URLs preserved) |
| [Buyer Room / Catalogue](buyer-room/catalogue/README.md) | Buyer-facing product discovery and selection | `buyer-room/catalogue/wix/` for Wix Studio source; root `catalogue-sidebar-v1.html` remains a legacy compatibility file |
| MASTER departments | Purchase, Account, Warehouse and Support internal operations | `purchase-live/`, `account-room/`, `warehouse-room/`, `support-room/`; backend records in `integration/backend/` and page bridges in `integration/wix/` |

The root `assets/` directory remains at its existing URL because both workspaces already reference files there. Each asset's ownership is listed in the area README. Do not move a root HTML page or a referenced asset merely to make the folders look tidy: that would change GitHub Pages URLs used by Wix.

Wix owns authentication, product CMS, access controls, and publication. Source files here are **not** the live Catalogue until explicitly applied and published in Wix Studio. No Catalogue change should be treated as a Sales Room change.

