import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  const downloadButton = $w('#downloadOrderExcelButton');
  const closeButton = $w('#closeButton');
  const downloadUrl = String(context.downloadUrl || '').trim();

  downloadButton.label = downloadUrl ? 'Download Order Excel' : 'Excel Unavailable';
  // Keep the Buyer Room and this success lightbox in place while Chrome hands
  // the attachment response to its download manager. A self-targeted link turns
  // the file request into a main-frame navigation, which strict browser control
  // layers can block before the download manager sees it.
  downloadButton.target = '_blank';
  if (downloadUrl) {
    downloadButton.link = downloadUrl;
    downloadButton.enable();
  } else {
    downloadButton.disable();
  }

  closeButton.onClick(() => wixWindowFrontend.lightbox.close({ action: 'close' }));
});
