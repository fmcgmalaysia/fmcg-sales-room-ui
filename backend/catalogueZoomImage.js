import https from 'https';

const edge = 512;
const maxBytes = 160 * 1024;
const host = 'https://static.wixstatic.com/media/';
const options = { suppressAuth: true, consistentRead: true };
const idPattern = /^[A-Za-z0-9_~-]+\.(?:jpe?g|png|webp)$/i;
const frameMarkers = new Set([0xc0, 0xc1, 0xc2]);

function sourceId(value) {
  if (typeof value !== 'string') return '';
  if (value.startsWith(host)) return value.slice(host.length);
  return /^wix:image:\/\/v1\/([^/]+)\//.exec(value)?.[1] || '';
}

function jpegWithinBounds(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16 || bytes.length > maxBytes ||
      bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset++] === 0xff) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (frameMarkers.has(marker) && length >= 8) {
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 && Math.max(width, height) <= edge;
    }
    offset += length;
  }
  return false;
}

function downloadJpeg(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode !== 200 || !/^image\/jpeg\b/i.test(String(response.headers['content-type'] || ''))) {
        response.resume();
        reject(Error('Catalogue zoom unavailable.'));
        return;
      }
      let size = 0;
      const chunks = [];
      response.on('error', reject);
      response.on('aborted', () => reject(Error('Catalogue zoom interrupted.')));
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) response.destroy(Error('Catalogue zoom too large.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('error', reject);
    request.setTimeout(3500, () => request.destroy(Error('Catalogue zoom timed out.')));
  });
}

export function createCatalogueZoomReader({ data, download = downloadJpeg }) {
  return async product => {
    const id = sourceId(product.image);
    if (!idPattern.test(id)) return null;
    const result = await data.query('CatalogueImageAssets').eq('_id', product._id).eq('status', 'VERIFIED')
      .fields('sourceId', 'originalId', 'originalHash').limit(1).find(options);
    const asset = result.items[0];
    if (asset?.sourceId !== id || !asset.originalId || asset.originalId === id || !asset.originalHash) return null;
    // Send only the bounded derivative bytes. The CMS reference and Wix media URL stay on the server.
    const jpeg = await download(host + id + '/v1/fit/w_512,h_512,q_85/file.jpg');
    return jpegWithinBounds(jpeg) ? jpeg.toString('base64') : null;
  };
}
