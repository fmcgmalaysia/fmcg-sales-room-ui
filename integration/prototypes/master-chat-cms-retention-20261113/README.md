# MASTER chat retention isolation

Recovery source is 930365b5 and the matching Wix chat service from aa97266c. The trial uses synthetic Warehouse and Support messages modeled after AVATA 001 Desk 1. It does not call production.

Run the contract.test.cjs file with node --test. The fixture uses in-memory maps and injected delays. It verifies the intended call path.

## Before release

- Verify unique inserts and concurrent sends from separate Wix invocations. Test reply order, monotonic personal receipts and delayed retries after archiving. The Wix update API does not document an atomic conditional update for a conversation head.
- Confirm the existing authorization wrapper applies to every recent read, archive read, send and receipt.
- Verify archive identity, payload and order before exposing the archive copy or clearing the CMS body. Test Drive and cleanup failures with real adapters and a private test archive.
- The test retains a small request digest for each archived message to demonstrate late retries. One permanent CMS row per digest would defeat the record-count savings. Decide how to bound and query replay evidence before release. The same applies to receipt records.
- Use repeated first-open samples on both workrooms and check actual MASTER CMS usage. The prior live samples of about five seconds cannot be compared with injected fixture delays.

This branch carries isolation evidence only. There are no production collection, scheduler, code, or data changes.
