(() => {
  'use strict';

  const thumbnails = [
    '#entry img.receipt-thumb',
    '#entry .receipt-preview-button img',
    '.dd-photo-strip button img',
    '#whPhotoDraft img',
  ].join(', ');
  const preview = document.createElement('div');
  if (typeof preview.showPopover !== 'function') return;
  preview.className = 'warehouse-image-hover';
  preview.setAttribute('popover', 'manual');
  preview.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img');
  image.alt = '';
  preview.append(image);
  document.body.append(preview);
  let source;
  const watchThumbnail = new MutationObserver(() => {
    if (source && !source.isConnected) hide();
  });

  function hide() {
    if (!source) return;
    source = undefined;
    watchThumbnail.disconnect();
    if (preview.matches(':popover-open')) preview.hidePopover();
    image.removeAttribute('src');
  }

  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const thumbnail = event.target.closest?.(thumbnails);
    if (!thumbnail?.complete || !thumbnail.naturalWidth) {
      hide();
      return;
    }

    if (thumbnail !== source) {
      hide();
      source = thumbnail;
      image.referrerPolicy = thumbnail.referrerPolicy;
      image.src = thumbnail.currentSrc || thumbnail.src;
      preview.showPopover();
      watchThumbnail.observe(document.body, { childList: true, subtree: true });
    }

    const gap = 14;
    const edge = 10;
    const { width, height } = preview.getBoundingClientRect();
    const left = event.clientX + gap + width > innerWidth - edge ? event.clientX - width - gap : event.clientX + gap;
    const top = event.clientY + gap + height > innerHeight - edge ? event.clientY - height - gap : event.clientY + gap;
    preview.style.left = Math.max(edge, left) + 'px';
    preview.style.top = Math.max(edge, top) + 'px';
  }, { passive: true });
  document.addEventListener('pointerout', event => {
    if (event.target === source) hide();
  }, { passive: true });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('close', hide, true);
  document.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
})();
