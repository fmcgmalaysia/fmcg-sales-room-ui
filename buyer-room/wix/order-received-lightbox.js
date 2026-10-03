import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  // This popup predates the named-code convention. Keep the real Wix element
  // ID here so the button receives its signed URL instead of failing during
  // initialization on a selector that does not exist in the live lightbox.
  const downloadButton = $w('#comp-mupidwxx');
  const downloadUrl = String(context.downloadUrl || '').trim();

  downloadButton.label = downloadUrl ? 'Download Order Excel' : 'Excel Unavailable';
  // The endpoint returns an attachment, so a same-tab request starts Chrome's
  // download manager while leaving the lightbox in place. A new-tab target can
  // stop at about:blank and never request the signed file URL.
  downloadButton.target = '_self';
  if (downloadUrl) {
    downloadButton.link = downloadUrl;
    downloadButton.enable();
  } else {
    downloadButton.disable();
  }

});
