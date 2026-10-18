import { Permissions, webMethod } from 'wix-web-module';
import { mediaManager } from 'wix-media-backend';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';

const TEST_FILE_URL = 'wix:document://v1/4ecd18_cede7cd9c8514e59afb457bbb9b648db.xlsx/fmcgmalaysia.com-buyer-room-download-test.xlsx';
function failure(step, error) {
  const result = { ok: false, step, message: error?.message || String(error) };
  console.error('Excel fixed-file probe', result);
  return result;
}
// Diagnostic complete: retained locally and disabled for frontend calls.
const getTestXlsxDownloadUrl = webMethod(Permissions.SiteMember, async () => {
  try {
    const member = await currentMember.getMember({ fieldsets: ['FULL'] });
    const memberId = String(member?._id || '').trim();
    const email = String(member?.loginEmail || '').trim().toLowerCase();
    if (!memberId) throw new Error('Sign in is required.');
    let matches = (await wixData.query('StaffMaster').eq('wixMemberId', memberId).limit(2).find({ suppressAuth: true })).items;
    if (!matches.length && email) matches = (await wixData.query('StaffMaster').eq('staffEmail', email).limit(2).find({ suppressAuth: true })).items;
    if (matches.length !== 1 || String(matches[0].status || '').trim().toUpperCase() !== 'ACTIVE' || !['ADMIN', 'SUPER ADMIN'].includes(String(matches[0].role || '').trim().toUpperCase())) throw new Error('Active staff administrator is required.');
  } catch (error) { return failure('staffAdmin', error); }
  let info;
  try { info = await mediaManager.getFileInfo(TEST_FILE_URL); }
  catch (error) { return failure('getFileInfo', error); }
  let url;
  try { url = await mediaManager.getDownloadUrl(info.fileUrl, 10, null, null); }
  catch (error) { return failure('getDownloadUrl', error); }
  if (typeof url !== 'string' || !url.startsWith('https://')) return failure('validateUrl', new Error('Unexpected URL'));
  return { ok: true, url, expiresAt: Date.now() + 600000, sizeInBytes: info.sizeInBytes, isPrivate: info.isPrivate };
});
