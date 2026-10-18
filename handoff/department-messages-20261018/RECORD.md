# Department messages and read receipts — candidate

User authorized starting the Purchase, Account and Warehouse messaging optimization and separately requested waiting pills 30 percent lighter. This candidate implements the first communication slice: staff messages, separate system updates, personal read receipts, explicit acknowledgement and links to existing issue workflows. It does not implement the entire Warehouse redesign or a new issue-resolution state machine.

## Authority and recovery

Read root AGENTS.md, the complete START_HERE.md, system ownership, MASTER workroom standards and current supplier-closeout/document-issue release records before business edits. Recovery is runtime6868c8b, documentation98fd930 / PR185. Existing annotated verified/purchase-row-drag-save-20261016 protects only its Purchase acceptance scope; no broad Finance transaction tag is inferred.

Fresh complete Wix Purchase, Account, Warehouse and stockExceptions.web sources matched the checkout after newline normalization. Seven relevant public frontend files also matched. Exact before sources, hashes and comparison JSON are kept privately in the root handoff directory. No live Wix or production business record was modified during candidate preparation.

## Isolated objectives

Waiting-pill color is a separate two-line commit0ba6e31 on style/waiting-pill-lighter-20261018. It blends the existing #8B98A8 30 percent toward white, resulting in #AEB7C2. Only Awaiting Review and Waiting for Acc. response pills change; missing document buttons, text, geometry and state logic remain unchanged.

The messaging branch is stacked on that color branch. New departmentMessages.js projects existing issues and writes message/read/ack events to the existing company activity collection through the existing operation journal and company Purchase scope. It does not write PurchaseOrders, money, quantities, document status or closure flags. Existing stock functions remain unchanged; two additional authenticated web methods are appended to the same web module. Three Wix pages add only the message bridge and a version pointer. Existing entry identifiers and handlers are retained.

Sender identity and timestamps come from server-authenticated staff. Allowed departments come from the three existing Purchase, Account and Warehouse authorizers, each operating on the same fresh member and staff records. Their Super Admin and Top Management rules remain authoritative; no role or department assignment is changed. Company scope and PO existence are checked. Only sender/recipient departments receive a message; replies cannot silently expand its audience. Warehouse does not receive Finance-only messages or Finance document-issue content. No Buyer or Sales messages are sent by this module.

## User behavior

- Message columns and a Messages entry expose per-PO threads; legacy note content remains available in its existing column wrapper.
- Human messages have an outline person icon, department, actor and time. System events use a separate muted icon/row. Existing unresolved issues remain pinned and link into the original department workflow.
- Opening a department homepage or table summary is not a read. A message's start and end must have been visible in the open panel while the document is visible before a personal READ is queued. Read-by and explicit ACK are different persisted events.
- Read receipts remove only that employee's unread state. New messages create new unread markers. A requested acknowledgement is an explicit action; its actor/time is visible to other participants. It does not resolve issues, alter receiving or enable Job Done.
- Same-request retries protect against uncertain results. Server actor/time ignore submitted impersonation fields. Message drafts are retained in memory across panel close/reopen within the page; page reload/offline draft restoration is not claimed.
- Account system copy is English. Purchase/Warehouse explanations are bilingual with no slash separator. Pending manual message saves block accidental navigation/closure; existing forms are not refreshed.

## Validation and limits

Seven new backend scenarios cover personal reads, department acknowledgement, company/audience boundaries, spoofing, ordinary-message ACK rejection, unchanged financial/receiving/closure facts, new unread state, lost-result retries and closed-account communication. Existing supplier-closure regression also passes. Full576 tests:573 pass, same three historical baseline failures (missing PURCHASE_DOCUMENT_TYPES test binding, INSTALLMENT_PAID expectation, English customer feedback expectation).

Chrome uses actual department frontend code and actual message-operation/projection logic in an isolated in-memory sample. Sample IDs use a deterministic demonstration identity generator; production retains crypto SHA-256. No production CMS, Drive or payment writes occur. Browser evidence and the preview transport remain private and are not included in the production payload. Public company data is not used as a test fixture.

Message attachments, Warehouse packing/loading photo persistence, offline upload recovery, deadline-based escalation and a replacement issue workflow are not implemented by this slice. Existing file/shortage/stock resolution remains authoritative. Their later implementation must be separately scoped against live code.

Release status: code candidate only; GitHub synchronization, Pages deployment, Wix synchronization/publish and public verification must be recorded separately. Do not report this candidate as published or merge it into main.

Chrome acceptance: Purchase and Finance pills measured rgb(174,183,194), white text,21px height; document gray is unchanged. Actual shared panels verified personal READ then explicit ACK, preserved unsent draft on close/reopen, Purchase reply visible to Warehouse, independent Finance unread state, and original shortage/Finance/receiving entry navigation. After Warehouse ACK, the original receiving panel still shows500 planned,480 accepted,20 remaining with issue unresolved.390px viewport: message panel358px, scrollWidth358px and16px editable text. No relevant localhost8936 console errors. Screenshot evidence remains private. Three additional live authorizer sources matched current repository hashes.
