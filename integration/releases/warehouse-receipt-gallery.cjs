const assert = require('node:assert/strict');

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, () => after);
}

const gallery = `<label class="receipt-camera" title="Gallery 手机相册"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg><input type="file" data-receipt-photo accept="image/jpeg,image/png,image/webp" aria-label="Choose photo from gallery '+esc(line.barcode)+'"></label>`;

function receiptScript(source) {
  const markup = `function receiptPhotoField(line){return '<div class="receipt-evidence"><label`;
  const closing = '</label><div data-receipt-preview></div></div>';
  const fields = "const field=item.querySelector('[data-receipt-photo]');if(!field)continue;";
  const disable = 'field.disabled=hidden||saving||Boolean(pending)||receiptPhotoReading;';
  source = replaceOnce(source, markup, markup.replace('<label','<div class="receipt-photo-actions"><label'));
  source = replaceOnce(source, closing, '</label>'+gallery+'</div><div data-receipt-preview></div></div>');
  source = replaceOnce(source, fields, "const fields=item.querySelectorAll('[data-receipt-photo]');if(!fields.length)continue;");
  source = replaceOnce(source, "section.querySelector('.receipt-camera').hidden=Boolean(photo);", "section.querySelector('.receipt-photo-actions').hidden=Boolean(photo);");
  return replaceOnce(source, disable, 'for(const field of fields)'+disable);
}

function receiptStyle(source) {
  source = replaceOnce(source, '--receipt-columns: 26px minmax(0, 1fr) 52px 58px 50px 54px;', '--receipt-columns: 26px minmax(0, 1fr) 52px 58px 50px 68px;');
  source = replaceOnce(source, '--receipt-columns: repeat(3, minmax(0, 1fr)) 58px;', '--receipt-columns: repeat(3, minmax(0, 1fr)) 92px;');
  return source + `\n#entry .receipt-photo-actions { display: flex; gap: 4px; }\n#entry .receipt-photo-actions[hidden] { display: none; }\n@media (max-width: 560px) {\n  #entry .receipt-photo-actions .receipt-camera { width: 44px; min-height: 44px; }\n}\n`;
}

function receiptEntry(source) {
  const version = '20261115-warehouse-receipt-gallery-v1';
  source = replaceOnce(source, 'app.js?v=20261114-warehouse-stock-issues-v1', `app.js?v=${version}`);
  return replaceOnce(source, 'workroom.css?v=20261115-warehouse-image-hover-v1', `workroom.css?v=${version}`);
}

module.exports = {
  'warehouse-room/app.js': receiptScript,
  'warehouse-room/workroom.css': receiptStyle,
  'warehouse-room/index.html': receiptEntry,
};
