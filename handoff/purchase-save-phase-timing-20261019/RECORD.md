# Purchase save phase timing candidate — 2026-10-19

Objective: identify whether Purchase save latency is spent in staff lookup or business operations, and distinguish server execution from the browser's later full reload. No optimization claim yet.

Recovery: production purchaseOperations.web.js captured freshly from Wix and matches repository exactly after newline normalization. Exact private copy: root handoff/master-save-performance-20261019/purchaseOperations.web.before.js. Recovery code parent e655b06; existing verified/department-ui-before-20261018 reference remains preserved. Earlier zero-stock visual release is independently complete at ea92377.

Patch only adds per-call timestamps and one best-effort MASTER_SAVE_TIMING console event to savePurchaseOperation. Records company/requestId/operation/start/staffMs/operationMs/totalMs/threw; never logs input, staff identity, customer details or tokens. Same webMethod permission, staff function, branches, arguments, returns, existing error policy, locks, storage, endpoints and business events. Logging is optional and exceptions cannot override the save result.

Validation: 52 existing/targeted checks pass, including unchanged receipts/errors, logger failure isolation, pre-authorization failure and omission of private input. The initial unguarded local logger failed a mocked-console test; it was reverted to baseline, baseline50 passed, then guarded logging applied. No failing candidate was synchronized to Wix.

Code candidate only. No live diagnostic write, Wix synchronization or deployment yet. Apps Script source and active deployment unchanged. The test scope permits diagnosis; project per-branch deployment protection remains applicable. Next release must preserve source, Pages deployment policy, Wix receipt and actual log verification.

Final candidate9fcc414/draftPR201 pushed. User deployment-branch authorization requested and pending; no Wix diagnostic draft/code writes. Existing18 navigation views checked without relevant observed error (Purchase6,Finance7,Warehouse3,Support2); this is not complete save-action coverage. Root private W01 confirms fake1carton on marked testPO; original888888100|95 retained. Upload filechooser unavailable to automation; do not classify as website failure. AppsScript source remains exact repository and deploymentVersion7; neither saved nor redeployed. Current live diagnostic remains absent until approved scoped release.
