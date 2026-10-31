# Purchase payment follow-up consistency

Scope approved2026-10-31: remove T from the Requested timestamp, suppress edit access after first confirmed outgoing payment, and present existing PO business notices as message bubbles with a Message-column preview. Do not change PO amounts, stock, allocation, borrowing/repayment, financial entries, installment settlement, file delivery or chat storage.

## One lock authority

Purchase request edit permission additionally requires the existing canonical procurementContentLocked projection to be explicitly false and final reconciliation/account closure to be absent. The same helper already controls the visible Editable entry, its dialog and submission. Missing authority fails closed. The backend REQUEST_PAYMENT transition rejects replacement of an already-submitted request when the existing procurementContentLock returns a lock. This closes stale-page direct submission without duplicating the permanent-lock rule. Confirmed first payment stays a fact after proof deletion/replacement or refund. Finance's original payment and second-installment operations, request/balance calculations, new-request stages and settlement writers are unchanged.

## Existing notices, new presentation

PO updates retain their original identities, timestamps, facts, filtering, recipients and notify flags. The workspace projection adds MESSAGE presentation and a display-only department derived from the original audit event or known Warehouse event. The existing special payment-proof notification retains ACCOUNT/from/notify. displayFrom is not an authorization or routing field; unknown provenance stays Update rather than inventing a sender. The Message preview now also includes already-visible PO business notices without a from field. Existing task/pair/company filtering, unread rules, SEND/READ/ACK, Drive authority and CMS index/cache are unchanged. No copied business event, message row, new query, timer or synchronization job is introduced.

The shared bubble renderer uses the actual displayed department instead of hard-coded Purchaser Dept. Finance stays English; existing bilingual decisions elsewhere remain unchanged. Other delivery notices retain their original presentation and all normal person-message handlers remain exact.

## Release and acceptance

Recovery is runtime1e883b8/recordace8e5c/build20261031-purchase-quiet-quantities-v1, preserving the separately deployed Warehouse receivingfc76b37. Latest historical annotated checkpoints retain their original narrow scope; no new user-frozen checkpoint is invented. Before edits, all98public static assets matched after newline normalization (94byte-exact); the three relevant backend modules and all four Wix page entries were freshly read and matched the repository. Exact private before/draft copies are in the local handoff/purchase-payment-message-20261031 directory.

The scoped package contains98static assets: Purchase app, shared task-chat renderer and four current room HTML references change; the other92 remain byte-identical. Three backend modules receive four isolated line edits; four Wix pages receive only one version-token replacement each. No unrelated inherited working files are included. Mandatory regressions cover payment handoff/request/settlement, permanent PO locks, shared chat authority, retry, read/ack, company separation and Sales/Support consumers. Chrome synthetic full/partial/unpaid rows verify edit visibility, original22px Requested capsule/date formatting and Message preview/bubbles. Formal release must separately record code, Pages, Wix published/live and fresh public verification; no main merge before user testing.

Source-row background unification remains outside this request and is not claimed complete.

## Published result

Runtime6eb562b/build20261031-purchase-payment-message-v1 completed one scoped Pages run41184068770/job124487262507. All98public resources match after newline normalization (94byte-exact). The temporary branch rule was removed immediately after success; the exact original seven branch patterns and zero tags were verified. Seven minimal Wix drafts were exact; Studio confirmed published and live. Source, Pages, Wix and public technical acceptance are complete; user acceptance and main merge remain pending.

Fresh native clean public pages rendered LAW/NCT and the new build in all four affected rooms. Purchase's two real Requested dates use DD-MM-YY HH:MM with no T, outside clickable controls, retaining22px capsules. Its fully and partially paid rows both have no Editable entry, while their original amount/paid/balance values and proofs remain unchanged. The original four TEST02 receiving/document/payment facts render as department-labeled bubbles and the latest eligible notice appears in Message. Finance shows the same notices in English. Warehouse displays receiving/supplier-document notices and excludes the payment-proof notice. Support retains its original message entry/empty-thread state and Desk1→2→1 navigation. No captured relevant page errors. The server stale-edit rejection and subsequent50percent installment arithmetic were tested in memory; no actual financial, stock or procurement mutation or new chat SEND was performed. Opening existing chats may update their original personal read cursors.

Private evidence: public-followup.png, public-requested.png, public-messages.png, public-finance-messages.png, public-warehouse-messages.png, PUBLIC_ROOM_MARKERS.json, PUBLIC_RELEASE_VERIFICATION.json, permissions-restored.png and wix-published.png in the local handoff directory. Public screenshots and operational data are not bundled into the static site.
