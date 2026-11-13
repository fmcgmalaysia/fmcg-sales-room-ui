# MASTER chat retention isolation

Recovery source is 930365b5 and the matching Wix chat service from aa97266c. The trial uses synthetic Warehouse and Support messages modeled after AVATA 001 Desk 1. It does not call production.

Run `node --test integration/prototypes/master-chat-cms-retention-20261113/*.test.cjs` from the checkout. The contract fixture uses in-memory maps and injected delays. The sequence-page suite also runs the existing Drive state machine with in-memory storage to check the numeric cursor, original message IDs, and personal receipts. An archive-only conversation exposes Earlier messages before making a Drive call. The reader rejects an incomplete or unordered page so the caller can retry with the original cursor.

## Before release

- Verify unique inserts and concurrent sends from separate Wix invocations. Test reply order, monotonic personal receipts and delayed retries after archiving. Reuse the conditional update verified on MASTER's synthetic StockProtocolTest, then confirm it against the chat storage schema in isolation.
- Confirm the existing authorization wrapper applies to every recent read, archive read, send and receipt.
- Verify archive identity, payload and order before exposing the archive copy or clearing the CMS body. Test Drive and cleanup failures with real adapters and a private test archive.
- The test retains a small request digest for each archived message to demonstrate late retries. One permanent CMS row per digest would defeat the record-count savings. Decide how to bound and query replay evidence before release. The same applies to receipt records.
- Use repeated first-open samples on both workrooms and check actual MASTER CMS usage. The prior live samples of about five seconds cannot be compared with injected fixture delays.
- The reader expects one consistent snapshot of the published archive boundary and the recent rows. The CMS adapter must implement that contract, including retrying when the boundary moves during a read. The prototype does not yet supply the CMS adapter or wire the reader into the existing authorization wrapper.

## Measured on the independent Wix site

The administrator preview used a private collection containing five synthetic messages. Five consistent reads returned sequences 4–8 in 138, 168, 190, 970, and 274 ms. A separate read-only preview measured 139 ms in the CMS query and 658 ms for the browser-to-backend round trip. Both probes made zero Drive calls. These samples exclude staff authentication and the workroom UI.

The private synthetic Drive file was read back and verified independently. Wix-to-Drive and two real staff accounts have not been exercised together. This branch carries isolation evidence only. There are no production collection, scheduler, code, or data changes.
