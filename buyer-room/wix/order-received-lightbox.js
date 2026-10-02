import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  // This popup predates the named-code convention. Keep the real Wix element
  // ID here so the button receives its signed URL instead of failing during
  // initialization on a selector that does not exist in the live lightbox.
  const downloadButton = $w('#comp-mupidwxx');
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

});
