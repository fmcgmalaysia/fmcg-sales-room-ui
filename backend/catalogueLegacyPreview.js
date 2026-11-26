import https from 'https';

const IMAGE_URL = /^wix:image:\/\/v1\/([\w~-]+\.(?:jpe?g|png|webp))\//i;
const WIX_CDN = /^https:\/\/static\.wixstatic\.com\/media\/([\w~-]+\.(?:jpe?g|png|webp))$/i;
const MAX_BYTES = 24000;
const EDGE = 128;
const OPTIONS = { suppressAuth:true, consistentRead:true };

function previewBytes(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode !== 200 || !/^image\/jpeg\b/i.test(response.headers['content-type'] || '')) {
        response.destroy();
        reject(Error('Preview unavailable.'));
        return;
      }
      let size = 0;
      const chunks = [];
      response.on('error', reject);
      response.on('aborted', () => reject(Error('Preview interrupted.')));
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) response.destroy(Error('Preview is too large.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks, size)));
    });
    request.setTimeout(1200, () => request.destroy(Error('Preview timed out.')));
    request.on('error', reject);
  });
}

// Return only the JPEG picture data. Application and comment segments can contain original
// metadata or embedded files. Reject unsupported or malformed files instead of returning them.
export function cleanCatalogueJpeg(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES || bytes.length < 16 ||
      bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length-2) !== 0xffd9) return '';
  const parts = [bytes.subarray(0,2)];
  let frame = 0, scans = 0;
  for (let at=2; at<bytes.length-2;) {
    if (at+4>=bytes.length || bytes[at] !== 0xff) return '';
    const marker = bytes[at+1];
    const length = bytes.readUInt16BE(at+2);
    const end = at+2+length;
    if (length < 2 || end > bytes.length-2) return '';
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 8 || frame) return '';
      const height = bytes.readUInt16BE(at+5);
      const width = bytes.readUInt16BE(at+7);
      if (!width || !height || width > EDGE || height > EDGE) return '';
      frame = marker;
    }
    if (marker === 0xda) {
      if (!frame || ++scans > (frame===0xc2 ? 20 : 1)) return '';
      let cursor=end;
      while (cursor < bytes.length-2) {
        if (bytes[cursor++] !== 0xff) continue;
        const tag=bytes[cursor];
        if (tag !== 0 && !(tag >= 0xd0 && tag <= 0xd7)) {
          cursor--;
          break;
        }
        cursor++;
      }
      if (cursor===end) return '';
      parts.push(bytes.subarray(at,cursor));
      at=cursor;
      continue;
    }
    if ([0xc0,0xc2,0xc4,0xdb,0xdd].includes(marker)) parts.push(bytes.subarray(at,end));
    else if (marker !== 0xfe && !(marker >= 0xe0 && marker <= 0xef)) return '';
    at=end;
  }
  if (!scans) return '';
  parts.push(bytes.subarray(bytes.length-2));
  return 'data:image/jpeg;base64,'+Buffer.concat(parts).toString('base64');
}

// Only selected page IDs reach this adapter. Deliver the small picture, never the
// source reference. The protected service checks permission and budget before calling.
export function createCatalogueLegacyPreview({data, download=previewBytes, now=Date.now}) {
  const cache=new Map();
  const pending=new Map();
  return async products => {
    const missing=products.filter(p=>!p.image);
    if (!missing.length || missing.length > 50) return products;
    let rows;
    try {
      const page=await data.query('FMCGMALAYSIA').eq('pointBaseStatus','ACTIVE')
        .hasSome('_id',missing.map(p=>p.id)).fields('_id','image').limit(missing.length).find(OPTIONS);
      rows=page.items;
    } catch { return products; }
    const ready=new Map();
    let pointer=0;
    async function worker() {
      while (pointer < rows.length) {
        const row=rows[pointer++];
        if (typeof row.image !== 'string') continue;
        const id=(IMAGE_URL.exec(row.image)||WIX_CDN.exec(row.image))?.[1];
        if (!id) continue;
        const hit=cache.get(id);
        if (hit?.until > now()) {
          ready.set(row._id,hit.image);
          continue;
        }
        let task=pending.get(id);
        if (!task) {
          task=download('https://static.wixstatic.com/media/'+id+'/v1/fit/w_128,h_128/file.jpg')
            .then(cleanCatalogueJpeg).catch(()=> '').then(image=>{
              if(cache.size>=500)cache.delete(cache.keys().next().value);
              cache.set(id,{image,until:now()+(image?300000:30000)});
              return image;
            }).finally(()=>pending.delete(id));
          pending.set(id,task);
        }
        ready.set(row._id,await task);
      }
    }
    await Promise.all(Array.from({length:Math.min(rows.length,8)},worker));
    return products.map(p=>p.image||!ready.get(p.id)?p:{...p,image:ready.get(p.id)});
  };
}
