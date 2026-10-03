import wixWindowFrontend from 'wix-window-frontend';
import wixLocationFrontend from 'wix-location-frontend';

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
    // This lightbox uses a regular Wix Button. Unlike the Buyer Room page's
    // dedicated download link, assigning `.link` does not produce an href in
    // the published lightbox DOM. Navigate explicitly on click so the signed
    // attachment endpoint is always requested.
    downloadButton.onClick(() => wixLocationFrontend.to(downloadUrl));
    downloadButton.enable();
  } else {
    downloadButton.disable();
  }

});
