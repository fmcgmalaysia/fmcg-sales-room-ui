import { Permissions, webMethod } from 'wix-web-module';
import { mediaManager } from 'wix-media-backend';

const TEST_FILE_URL = 'wix:document://v1/4ecd18_cede7cd9c8514e59afb457bbb9b648db.xlsx/fmcgmalaysia.com-buyer-room-download-test.xlsx';
function failure(step, error) {
  const result = { ok: false, step, message: error?.message || String(error) };
  console.error('Excel fixed-file probe', result);
  return result;
}
export const getTestXlsxDownloadUrl = webMethod(Permissions.Admin, async () => {
  let info;
  try { info = await mediaManager.getFileInfo(TEST_FILE_URL); }
  catch (error) { return failure('getFileInfo', error); }
  let url;
  try { url = await mediaManager.getDownloadUrl(info.fileUrl, 10, null, null); }
  catch (error) { return failure('getDownloadUrl', error); }
  if (typeof url !== 'string' || !url.startsWith('https://')) return failure('validateUrl', new Error('Unexpected URL'));
  return { ok: true, url, expiresAt: Date.now() + 600000, sizeInBytes: info.sizeInBytes, isPrivate: info.isPrivate };
});
