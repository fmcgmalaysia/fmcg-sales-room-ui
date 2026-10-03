import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  const closeButton = $w('#closeButton');
  const downloadButton = $w('#downloadOrderExcelButton');
  const downloadReady = context.downloadReady === true;

  closeButton.onClick(() => wixWindowFrontend.lightbox.close());

  downloadButton.label = downloadReady ? 'Download Order Excel' : 'Excel Unavailable';
  if (downloadReady) {
    downloadButton.enable();
    downloadButton.onClick(() => {
      downloadButton.disable();
      downloadButton.label = 'Preparing Download…';
      wixWindowFrontend.lightbox.close({ action: 'download' });
    });
  } else {
    downloadButton.disable();
  }

});
