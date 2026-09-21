import wixWindowFrontend from "wix-window-frontend";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function detailRow(label, value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "";
  }

  return `<p style="margin:0 0 9px 0;line-height:1.25;white-space:nowrap;">
  <strong style="display:inline-block;width:155px;font-size:12px;letter-spacing:.02em;">${escapeHtml(label)}</strong>
  <span style="font-size:15px;">${escapeHtml(value)}</span>
</p>`;
}

function formatCbm(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4) : "0.0000";
}

$w.onReady(function () {
  const product = wixWindowFrontend.lightbox.getContext() || {};

  if (product.image) {
    $w("#productImage").src = product.image;
  }
  $w("#productImage").alt = product.imageAltText || product.name || "Product image";

  $w("#packagingNote").html =
    '<p style="margin:0;color:#666;font-size:11px;line-height:1.35;"><em>' +
    'Product packaging may be updated from time to time and may differ from the image shown.' +
    '</em></p>';

  $w("#productDetails").html =
    '<div>' +
    `<h2 style="margin:0 0 5px 0;font-size:25px;line-height:1.15;">${escapeHtml(product.name)}</h2>` +
    `<p style="margin:0 0 14px 0;color:#555;font-size:14px;font-weight:600;">${escapeHtml(product.principle)}</p>` +
    detailRow("Packing Size", product.description) +
    detailRow("Unit Barcode", product.barcode) +
    detailRow("Inner Box Barcode", product.innerBoxBarcode) +
    detailRow("Carton Barcode", product.cartonBarcode) +
    detailRow("Country of Origin", product.countryOrigin) +
    detailRow("m3 / Ctn", formatCbm(product.m3Ctn)) +
    detailRow("Shelf Life", product.shelflife) +
    '</div>';
});
