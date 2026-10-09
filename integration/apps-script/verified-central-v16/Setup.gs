function setWixOnboardingSecretForSetup(){throw new Error('Setup already completed.');}

/**
 * One-time authorization check for the QD factory.
 * Reads the private destination folder and template, then performs a no-op
 * metadata write so the deployment account receives the Drive write scope
 * required to copy new customer QD files.
 */
function WIX_authorizeDriveAndSheets() {
  const folder = DriveApp.getFolderById(WIX_QD_FACTORY_CFG.DESTINATION_FOLDER_ID);
  const template = DriveApp.getFileById(WIX_QD_FACTORY_CFG.TEMPLATE_FILE_ID);
  template.setName(template.getName());
  const spreadsheet = SpreadsheetApp.openById(template.getId());
  const result = {
    folderName: folder.getName(),
    templateName: spreadsheet.getName()
  };
  console.log(JSON.stringify(result));
  return result;
}
