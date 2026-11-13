// Deploy only from a separate QA Apps Script project. Configure its own token,
// folder ID and file ID in script properties. No production IDs are accepted.
function doPost(e) {
  try {
    const body = e?.postData?.contents || '';
    if (body.length > 1024) return qaResponse_({ ok: false, error: 'INVALID_REQUEST' });
    const request = JSON.parse(body);
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('CHAT_QA_TOKEN');
    if (!token || token.length < 32 || !qaEqual_(token, request?.token)) {
      return qaResponse_({ ok: false, error: 'FORBIDDEN' });
    }

    const folder = DriveApp.getFolderById(props.getProperty('CHAT_QA_FOLDER_ID'));
    const file = DriveApp.getFileById(props.getProperty('CHAT_QA_ARCHIVE_ID'));
    if (folder.getName() !== 'MASTER Chat Retention QA — Synthetic Only'
      || file.getName() !== 'chat-qa-archive-001.json'
      || folder.getSharingAccess() !== DriveApp.Access.PRIVATE
      || file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getSize() > 16000) {
      return qaResponse_({ ok: false, error: 'INVALID_ARCHIVE' });
    }
    const parents = file.getParents();
    if (!parents.hasNext() || parents.next().getId() !== folder.getId() || parents.hasNext()) {
      return qaResponse_({ ok: false, error: 'INVALID_ARCHIVE' });
    }
    const archive = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    if (archive.fixture !== 'MASTER_CHAT_RETENTION_QA_V1' || archive.conversation !== 'QA-WAREHOUSE-SUPPORT-001') {
      return qaResponse_({ ok: false, error: 'INVALID_ARCHIVE' });
    }
    return qaResponse_({ ok: true, archive });
  } catch (_) {
    return qaResponse_({ ok: false, error: 'QA_ARCHIVE_UNAVAILABLE' });
  }
}

function qaEqual_(expected, given) {
  if (typeof given !== 'string' || expected.length !== given.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return mismatch === 0;
}

function qaResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
