import wixWindowFrontend from 'wix-window-frontend';
import wixLocationFrontend from 'wix-location-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  const closeButton = $w('#closeButton');
  const downloadButton = $w('#downloadOrderExcelButton');
  const downloadUrl = String(context.downloadUrl || '').trim();

  closeButton.onClick(() => wixWindowFrontend.lightbox.close());

  downloadButton.label = downloadUrl ? 'Download Order Excel' : 'Excel Unavailable';
  if (downloadUrl) {
    // Keep file creation on order submission, but make the user's button
    // click explicitly request the signed attachment. Wix lightbox links can
    // render with a valid href yet still be swallowed by the popup runtime.
    downloadButton.onClick(() => wixLocationFrontend.to(downloadUrl));
    downloadButton.enable();
  } else {
    downloadButton.disable();
  }

});
