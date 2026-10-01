import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  const downloadButton = $w('#downloadOrderExcelButton');
  const doneButton = $w('#doneButton');
  const downloadUrl = String(context.downloadUrl || '').trim();

  downloadButton.label = downloadUrl ? 'Download Order Excel' : 'Excel Unavailable';
  downloadButton.target = '_self';
  if (downloadUrl) {
    downloadButton.link = downloadUrl;
    downloadButton.enable();
  } else {
    downloadButton.disable();
  }

  doneButton.onClick(() => wixWindowFrontend.lightbox.close({ action: 'done' }));
});
