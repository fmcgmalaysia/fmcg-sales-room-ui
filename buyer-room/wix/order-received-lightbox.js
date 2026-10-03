import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  const closeButton = $w('#closeButton');
  const downloadButton = $w('#downloadOrderExcelButton');
  const downloadUrl = String(context.downloadUrl || '').trim();

  closeButton.onClick(() => wixWindowFrontend.lightbox.close());

  downloadButton.label = downloadUrl ? 'Download Order Excel' : 'Excel Unavailable';
  if (downloadUrl) {
    // Let the Buyer Room page request the attachment. Direct navigation from
    // inside a Wix lightbox can be swallowed without reaching Chrome's normal
    // download manager, while the page that opened it can navigate reliably.
    downloadButton.onClick(() => wixWindowFrontend.lightbox.close({
      action: 'download',
      downloadUrl
    }));
    downloadButton.enable();
  } else {
    downloadButton.disable();
  }

});
