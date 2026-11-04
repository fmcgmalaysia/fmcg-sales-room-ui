import wixWindowFrontend from 'wix-window-frontend';
import { createBuyerOrderDownload } from 'backend/catalogueAuth.web';

$w.onReady(function () {
  const context = wixWindowFrontend.lightbox.getContext() || {};
  const closeButton = $w('#closeButton');
  closeButton.hide(); // The Wix built-in X closes independently of this page code.
  const downloadButton = $w('#downloadOrderExcelButton');
  const orderId = String(context.orderId || '').trim();
  let preparingDownload = false;

  closeButton.onClick(() => wixWindowFrontend.lightbox.close());

  downloadButton.label = orderId ? 'Download Order Excel' : 'Excel Unavailable';
  if (orderId) {
    downloadButton.enable();
    downloadButton.onClick(async () => {
      if (preparingDownload) return;
      preparingDownload = true;
      downloadButton.disable();
      downloadButton.label = 'Preparing Download…';
      try {
        const download = await createBuyerOrderDownload(orderId, String(context.assistCustomerId || '').trim(), String(context.buyerRoomUrl || '').trim());
        const fileName = String(download?.fileName || '').trim(), base64 = String(download?.base64 || '').trim();
        if (!download?.ok || download.orderId !== orderId || !fileName || !base64) throw new Error('Order Excel response was incomplete.');
        wixWindowFrontend.lightbox.close({ action: 'download', orderId, fileName, base64 });
      } catch (error) {
        console.error('Order confirmed; Excel download failed', error);
        preparingDownload = false;
        downloadButton.label = 'Retry Excel Download';
        downloadButton.enable();
      }
    });
  } else {
    downloadButton.disable();
  }

});