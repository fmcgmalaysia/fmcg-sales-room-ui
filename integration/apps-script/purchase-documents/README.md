# Purchase document service (service v1 deployed; NCT public upload verified)

Release 2026-10-16: existing deployment now selects immutable version 4, adding Our PO PDF uploads and verified recoverable TRASH. See deployment-v4.json. The original deployment endpoint, owner, access and Drive scopes remain unchanged. Complete source readback and deployment receipt were recorded. Unauthenticated endpoint requests still fail before Drive access. Automated PO upload/TRASH, identity isolation and retry checks pass. Real website upload/delete acceptance with disposable user-selected files remains pending; no business file was deleted for testing.

Wix enforces original-uploader staff ID and Finance/payment locks before journaling a pending unlink. It verifies the exact Drive receipt before recording deletion. Lost receipts resume the same request and file ID. Upload metadata and deletion audit remain in CMS. No permanent purge operation exists.

On 2026-10-11 Google confirmed deployment version 1. See deployment-v1.json.
Code.gs was saved and its complete editor readback matched the local source.
Drive v3 was enabled in the editor. appsscript.json is a configuration template;
the full live manifest has not yet been captured, so it is not a live snapshot.
The owner confirmed the Script Property was saved and explicitly approved the
actual Drive OAuth scope and the web-app access setting. No secret is recorded here.
Master document integration was published in Purchase v15 and retained in v16/v17.
NCT public testing uploaded a 38 KB PI and final INV, verified fixed Drive destination,
readable PDFs, persistent PO association, orange/green state and unique staff/time audits.
The user selected local files because the automated chooser failed. Same-ID lost-receipt
retry passed automated tests only; GHR public upload remains untested. Purchase v17 and
Account layout v1 passed four-stage publication; Account financial data is unconnected.
See master-integration-status.json and integration/releases/purchase-closeout-v17.json.

Create a dedicated Apps Script project owned by the authorized Workspace account.
Do not install these files in the existing Onboarding, QD or Pointbase projects.

The service accepts only PDF files up to 3 MiB from the authenticated Master backend.
NCT/GHR destinations are fixed in Code.gs. It never changes Drive sharing or permanently deletes files; verified purchase files can be moved to Trash.
Master must persist the generated file ID before upload and reuse that ID after a timeout.
An existing file only counts as a completed retry when its company, P.O., content hash,
file name, size, MIME type and destination all match.

Configuration needed before use:

1. Install Code.gs and the manifest; enable Advanced Drive v3.
2. The owner personally enters a new random 32+ character
   `PURCHASE_DOCUMENT_SHARED_SECRET` in Script Properties and the identical value
   in Master Wix Secrets Manager. Never put the value in Git or chat.
3. The owner authorizes Drive access. The OAuth permission is broader than the
   two folders; the code restricts all file creation to the supplied purchase roots.
4. Create an immutable version and deploy as a web app executing as its owner.
   Server-to-server access must be configured deliberately; the application secret
   authenticates every POST. Record project ID, version and deployment ID.
5. The Master adapter uses the fixed, non-secret deployment URL recorded here;
   only the shared credential is stored in Wix Secrets Manager.
6. Verify an actual disposable PDF upload to each company, read back the file,
   retry the same ID without duplication, and confirm Master association and audit.

The chat's Drive connector is independent of the Wix website. A successful connector
folder read does not establish authorization for the website's upload service.

Official API references:
https://developers.google.com/apps-script/advanced/drive
https://developers.google.com/workspace/drive/api/guides/manage-uploads
