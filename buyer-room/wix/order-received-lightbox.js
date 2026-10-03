import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  const closeButton = $w('#closeButton');
  const downloadButton = $w('#downloadOrderExcelButton');
  const downloadUrl = String(context.downloadUrl || '').trim();

  closeButton.onClick(() => wixWindowFrontend.lightbox.close());

  downloadButton.label = downloadUrl ? 'Download Order Excel' : 'Excel Unavailable';
  downloadButton.target = '_self';
  if (downloadUrl) {
    // Use Wix's native button link. Wix documents that the link must be set
    // before the click rather than assigned from an onClick handler. The HTTP
    // endpoint responds as an attachment, so Chrome keeps the popup open and
    // sends the workbook to its normal download manager.
    downloadButton.link = downloadUrl;
    downloadButton.enable();
  } else {
    downloadButton.disable();
  }

});
