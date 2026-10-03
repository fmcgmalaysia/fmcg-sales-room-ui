import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  const closeButton = $w('#closeButton');
  const downloadButton = $w('#downloadOrderExcelButton');
  const downloadUrl = String(context.downloadUrl || '').trim();

  closeButton.onClick(() => wixWindowFrontend.lightbox.close());

  downloadButton.label = downloadUrl ? 'Download Order Excel' : 'Excel Unavailable';
  if (downloadUrl) {
    downloadButton.enable();
    downloadButton.onClick(() => {
      downloadButton.disable();
      downloadButton.label = 'Preparing Download…';
      wixWindowFrontend.lightbox.close({ action: 'download', downloadUrl });
    });
  } else {
    downloadButton.disable();
  }

});
