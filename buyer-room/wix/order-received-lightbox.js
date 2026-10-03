import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  // This popup predates the named-code convention. Keep the real Wix element
  // ID here so the button receives its signed URL instead of failing during
  // initialization on a selector that does not exist in the live lightbox.
  const downloadButton = $w('#comp-mupidwxx');
  const downloadUrl = String(context.downloadUrl || '').trim();

  downloadButton.label = downloadUrl ? 'Excel Download Started' : 'Excel Unavailable';
  if (downloadUrl) {
    // The Buyer Room page starts the attachment download before opening this
    // receipt. Keep this element as a clear status instead of a second control.
  }
  downloadButton.disable();

});
