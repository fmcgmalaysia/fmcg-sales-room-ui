# Purchase document service (service v1 deployed; Master connection pending)

On 2026-10-11 Google confirmed deployment version 1. See deployment-v1.json.
Code.gs was saved and its complete editor readback matched the local source.
Drive v3 was enabled in the editor. appsscript.json is a configuration template;
the full live manifest has not yet been captured, so it is not a live snapshot.
The owner confirmed the Script Property was saved and explicitly approved the
actual Drive OAuth scope and the web-app access setting. No secret is recorded here.
Master integration and actual PDF upload acceptance remain unfinished. This is
not a Purchase website release or a user-verified production baseline.

Create a dedicated Apps Script project owned by the authorized Workspace account.
Do not install these files in the existing Onboarding, QD or Pointbase projects.

The service accepts only PDF files up to 3 MiB from the authenticated Master backend.
NCT/GHR destinations are fixed in Code.gs. It never changes Drive sharing or deletes files.
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
5. Store the deployment URL in Master's `PURCHASE_DOCUMENT_SERVICE_URL` secret.
6. Verify an actual disposable PDF upload to each company, read back the file,
   retry the same ID without duplication, and confirm Master association and audit.

The chat's Drive connector is independent of the Wix website. A successful connector
folder read does not establish authorization for the website's upload service.

Official API references:
https://developers.google.com/apps-script/advanced/drive
https://developers.google.com/workspace/drive/api/guides/manage-uploads
