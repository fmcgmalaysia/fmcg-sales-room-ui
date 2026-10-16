# Dashboard customer Entry destination — 2026-10-16

Objective: Dashboard customer Entry must open the current Active Orders interface filtered to that customer, rather than the legacy customer Room. User explicitly requested this routing correction. The earlier Catch Cost/CBM discussion is outside this patch and has not been implemented.

## Scope and recovery

- Branch fix/purchase-dashboard-entry-20261016, based on c136d3994ac73a30966a50d1ce78d85cece3eacd. Existing limited annotated verified checkpoints remain unchanged; no whole-Purchase verification tag or main merge.
- Fresh public app.js/dashboard.js/index.html matched repository before edits. Full fresh Wix page matched the current po-review-v1 source; full after readback proved only the version token changed. Exact before/after snapshots and screenshots are retained locally.
- Only Dashboard customer-name/Entry buttons and the selected-item customer entry gain an additional marker; original data-customer attributes and other element/event identifiers remain. Marked entries open view=active with activeCustomer set to the selected customer, clear the legacy customerId and reset ordinary filters/selection as before. Unmarked legacy Room entry behavior remains unchanged. Clearing legacy customerId avoids this new entry caching an old Room return target.
- Drawer wording now says Open Active Orders / 查看客户采购任务 (rendered as bilingual separate text, without a slash). The directory Entry accessible name identifies Active Orders.
- Runtime files: purchase-live/app.js, dashboard.js and index.html build/cache token. Wix page src token only. No backend, CMS, price/CBM, permissions, saved procurement quantity, P.O., receipt or Account/Warehouse connection changed. No shared CSS or iframe geometry changed.

## Validation

-106 relevant checks passed,0 failed: purchase-live-ui, purchase-dashboard and purchase-source-grid. New tests verify the actual marked Entry opens the correct customer-filtered Active table with supplier child rows and Review P.O., no save, and that another customer's price draft retains its original task/version when saved later. Existing legacy Room, pending-save, selection, drag, partial procurement and readback checks remain.
- Reused the existing local preview window. Dashboard -> SAMPLE customer Entry opened Active Orders with SAMPLE selected, supplier filter All, original child/WAITING rows retained. No production data used or saved in the preview.
- Formal page was refreshed after confirming no open form, visible Save/Cancel or pending-result action. User subsequently reopened the formal page; reused tab51425534 without opening another formal window.
- Fresh formal iframe confirmed dashboard-entry-v1. From Dashboard, clicked Open SCOMMERCE PTE. LTD. Active Orders: heading Active Orders, customer SCOMM (MYR) selected and All Suppliers selected. Legacy roomhead/progress view absent. Six current real customer tasks visible, including CHIPSMORE50/35 with supplier35/WAITING15 and ECLIPSE100/100 with stock10.
- Opened existing NCT-PO-8465621 Review P.O. (20CTN/MYR1,321.05), then closed it; returned to the same Active customer filter. No real business Save or new P.O. was submitted.

## Four publication stages

1. Code04ee01def968010ebc03a8c428157a807722d855; Wix pointer1c5f7ac. Acceptance documentation follows separately. Main untouched pending user acceptance.
2. GitHub Pages run38850554515 succeeded at04ee01d. Marker2026-10-16-purchase-dashboard-entry-v1 and31 public assets verified exact after normalization. Temporary policy63231628 removed; original7 deployment rules restored exactly.
3. Wix Studio synchronized the sole token change; exact full before/after readback and published/live receipt captured. Existing right gutter retained.
4. Fresh formal Dashboard Entry -> customer-filtered Active Orders and Review P.O. return verified visually and functionally without a relevant error.

Permanent official URL: https://fmcg999.wixstudio.com/master . Local evidence: C:/FMCG-WIX-LOCAL/handoff/purchase-dashboard-entry-20261016/ . See evidence-hashes.json and pages-assets-verification.json. Unrelated pre-existing CRLF-only test change and untracked files remain untouched.
