const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const previousBuild = '20261111-warehouse-receipt-evidence-v1';
const build = '20261111-warehouse-compact-receipt-preview-v1';
const hash = content => crypto.createHash('sha256').update(content).digest('hex');

function replace(source, before, after) {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, () => after);
}

function patchIndex(source) {
  const columns = '<div class="receipt-columns" aria-hidden="true"><span>Product <small>产品</small></span><span>Expected <small>应收</small></span><span>Receipt <small>收货</small></span><span>Waiting <small>待收</small></span><span>Photo <small>照片</small></span></div>';
  const viewer = '<dialog id="receiptPhotoViewer" aria-labelledby="receiptPhotoTitle"><header><strong id="receiptPhotoTitle"></strong><form method="dialog"><button type="submit" aria-label="Close photo 关闭照片" autofocus>×</button></form></header><img id="receiptPhotoImage" alt="Receipt photo 收货照片"></dialog>';
  source = replace(source, '<div id="entryLines"></div>', columns + '<div id="entryLines"></div>');
  source = replace(source, '<details id="receiptDetails"><summary>Receipt History 收货记录</summary><div id="entryHistory"></div></details><p id="entryError" role="alert"></p></div><footer><button id="cancelEntry">Cancel</button><button class="primary" id="saveReceipt">Confirm</button></footer></dialog>', '<details id="receiptDetails"><summary>Receipt History 收货记录</summary><div id="entryHistory"></div></details><p id="entryError" role="alert"></p></div><footer><button id="cancelEntry">Cancel</button><button class="primary" id="saveReceipt">Confirm</button></footer></dialog>\n' + viewer);
  for (const ref of ['name="build" content="', 'workroom.css?v=', 'app.js?v=']) {
    source = replace(source, ref + previousBuild, ref + build);
  }
  return source;
}

function patchApp(source) {
  source = replace(source, 'class="receipt-camera">Camera 拍照<input', 'class="receipt-camera" title="Camera 拍照">拍照<input');
  source = replace(source, '<span data-receipt-preview></span>', '<div data-receipt-preview></div>');
  source = replace(source,
    ` preview.innerHTML=photo?'<img src="data:image/jpeg;base64,'+photo.base64+'" alt="Receipt photo 收货照片"><button type="button" data-receipt-remove aria-label="Remove receipt photo">×</button>':'';`,
    ` section.querySelector('.receipt-camera').hidden=Boolean(photo);
 preview.innerHTML=photo?'<button type="button" class="receipt-preview-button" data-receipt-zoom aria-label="Enlarge receipt photo 放大收货照片"><img src="data:image/jpeg;base64,'+photo.base64+'" alt=""></button><button type="button" class="receipt-remove" data-receipt-remove aria-label="Remove receipt photo 移除收货照片">×</button>':'';
}
function zoomReceiptPhoto(event){
 const trigger=event.target.closest('[data-receipt-zoom]');
 if(!trigger)return;
 const line=selected.lines[Number(trigger.closest('[data-line]').dataset.line)];
 const image=$('receiptPhotoImage');
 $('receiptPhotoTitle').textContent=line.name;
 image.src=trigger.querySelector('img').src;
 $('receiptPhotoViewer').showModal();`);
  source = replace(source, 'receiptPhotos.set(line.taskId,photo);renderReceiptPhoto(section,line);',
    "receiptPhotos.set(line.taskId,photo);renderReceiptPhoto(section,line);section.querySelector('[data-receipt-zoom]').focus();");
  source = replace(source, 'receiptPhotos.delete(line.taskId);renderReceiptPhoto(section,line);',
    "receiptPhotos.delete(line.taskId);renderReceiptPhoto(section,line);section.querySelector('[data-receipt-photo]').focus();");
  source = replace(source, `$('entryLines').addEventListener('click',removeReceiptPhoto);`,
    `$('entryLines').addEventListener('click',removeReceiptPhoto);
$('entryLines').addEventListener('click',zoomReceiptPhoto);
$('receiptPhotoViewer').addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 event.preventDefault();
 $('receiptPhotoViewer').close();
});
$('receiptPhotoViewer').addEventListener('close',()=>$('receiptPhotoImage').removeAttribute('src'));`);
  source = replace(source, 'Expected 应收数量<b>', '<span class="receipt-qty-label">Expected 应收</span><b>');
  source = replace(source, "${correcting?'Correct Total 更正累计':'This Receipt 本次收货'}<input", "<span class=\"receipt-qty-label\">${correcting?'Correct Total 更正累计':'This Receipt 本次收货'}</span><input");
  source = replace(source, 'Received 已收<b>', '<span class="receipt-qty-label receipt-qty-saved">Received 已收</span><b>');
  return replace(source, 'Waiting 待收<b data-waiting>', '<span class="receipt-qty-label">Waiting 待收</span><b data-waiting>');
}

function patchCss(source) {
  const start = source.indexOf('#entry{width:min(1040px,');
  assert.ok(start > 0);
  assert.match(source.slice(start).trimEnd(), /\.receipt-quantities\{grid-row:auto\}\}$/);
  return source.slice(0, start) + fs.readFileSync(path.join(__dirname, 'receipt-layout.css'), 'utf8').replace(/\r\n/g, '\n');
}

function stage(previous, destination) {
  const baseline = JSON.parse(fs.readFileSync(path.join(previous, 'warehouse-receipt-evidence-release.json')));
  assert.equal(baseline.build, previousBuild);
  assert.equal(baseline.resources.length, 96);
  const changes = new Map([
    ['warehouse-room/index.html', patchIndex],
    ['warehouse-room/app.js', patchApp],
    ['warehouse-room/workroom.css', patchCss]
  ]);
  const resources = baseline.resources.map(item => {
    const bytes = fs.readFileSync(path.join(previous, item.path));
    assert.equal(hash(bytes), item.sha256, item.path);
    const transform = changes.get(item.path);
    const content = transform ? Buffer.from(transform(bytes.toString('utf8'))) : bytes;
    const target = path.join(destination, item.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return { path: item.path, sha256: hash(content) };
  });
  const changed = resources.filter((item, index) => item.sha256 !== baseline.resources[index].sha256).map(item => item.path);
  assert.deepEqual(changed.slice().sort(), [...changes.keys()].sort());
  const manifest = { build, base: previousBuild, changed, resources };
  fs.writeFileSync(path.join(destination, 'warehouse-compact-receipt-preview-release.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

module.exports = { stage };
if (require.main === module) console.log(stage(process.argv[2], process.argv[3]).changed);
