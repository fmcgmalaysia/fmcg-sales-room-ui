import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  // This popup predates the named-code convention. Keep the real Wix element
  // ID here so the button receives its signed URL instead of failing during
  // initialization on a selector that does not exist in the live lightbox.
  const downloadButton = $w('#comp-mupidwxx');
  const downloadUrl = String(context.downloadUrl || '').trim();

  downloadButton.label = downloadUrl ? 'Download Order Excel' : 'Excel Unavailable';
  if (downloadUrl) {
    // Return the signed URL to the Buyer Room page. Navigation from inside a
    // Wix lightbox is silently swallowed on the published site, while the page
    // that opened the lightbox can start the attachment download reliably.
    downloadButton.onClick(() => wixWindowFrontend.lightbox.close({
      action: 'download',
      downloadUrl
    }));
    downloadButton.enable();
  } else {
    downloadButton.disable();
  }

});
