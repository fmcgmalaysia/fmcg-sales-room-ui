(function (root) {
  'use strict';

  const encoder = new TextEncoder();
  const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
  const cellText = (address, value, style = 0) => `<c r="${address}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  const cellNumber = (address, value, style = 0) => value === null || value === undefined || value === ''
    ? `<c r="${address}"${style ? ` s="${style}"` : ''}/>`
    : `<c r="${address}"${style ? ` s="${style}"` : ''}><v>${Number(value)}</v></c>`;

  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    return crc >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const chunks = [], central = [];
    let offset = 0;
    const append = bytes => { chunks.push(bytes); offset += bytes.length; };
    for (const [name, content] of files) {
      const nameBytes = encoder.encode(name), bytes = content instanceof Uint8Array ? content : encoder.encode(content), crc = crc32(bytes), start = offset;
      const local = new Uint8Array(30 + nameBytes.length), view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(8, 0, true);
      view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
      view.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
      append(local); append(bytes);
      central.push({ nameBytes, bytes, crc, start });
    }
    const centralStart = offset;
    for (const file of central) {
      const entry = new Uint8Array(46 + file.nameBytes.length), view = new DataView(entry.buffer);
      view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true);
      view.setUint32(16, file.crc, true); view.setUint32(20, file.bytes.length, true); view.setUint32(24, file.bytes.length, true);
      view.setUint16(28, file.nameBytes.length, true); view.setUint32(42, file.start, true); entry.set(file.nameBytes, 46);
      append(entry);
    }
    const end = new Uint8Array(22), endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, central.length, true);
    endView.setUint16(10, central.length, true); endView.setUint32(12, offset - centralStart, true);
    endView.setUint32(16, centralStart, true); append(end);
    const result = new Uint8Array(offset); let position = 0;
    for (const chunk of chunks) { result.set(chunk, position); position += chunk.length; }
    return result;
  }

  function buildSelectionExcel(data, watermarkBytes) {
    const url = new URL(String(data.buyerRoomUrl || ''));
    if (url.protocol !== 'https:') throw new Error('Buyer Room link is unavailable.');
    url.search = ''; url.hash = '';
    const currency = String(data.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Transaction currency is unavailable.');
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const headers = ['UNIT BARCODE', 'ITEM NAME', 'PACKING SIZE', 'EA', `${currency} /PC`, `${currency} /CTN`, 'CBM /CTN'];
    const validNumber = value => value === null || value === undefined || value === '' || Number.isFinite(Number(value));
    for (const item of rows) {
      if (!Number.isInteger(Number(item.ea)) || Number(item.ea) <= 0 || ![item.pricePerPc, item.pricePerCtn, item.cbmPerCtn].every(validNumber)) {
        throw new Error('The latest Catalogue values need review before export.');
      }
    }
    const now = new Date();
    const stamp = now.toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
    const header = `<row r="1" ht="28" customHeight="1">${cellText('A1', 'Open Buyer Room', 1)}${cellText('C1', `Exported ${stamp} (MYT)`, 3)}</row>`
      + `<row r="2" ht="26" customHeight="1">${headers.map((value, index) => cellText(`${String.fromCharCode(65 + index)}2`, value, 2)).join('')}</row>`;
    const body = rows.map((item, index) => {
      const r = index + 3;
      return `<row r="${r}">${cellText(`A${r}`, item.unitBarcode)}${cellText(`B${r}`, item.itemName)}${cellText(`C${r}`, item.packingSize)}`
        + `${cellNumber(`D${r}`, item.ea, 4)}${cellNumber(`E${r}`, item.pricePerPc, 5)}${cellNumber(`F${r}`, item.pricePerCtn, 5)}`
        + `${cellNumber(`G${r}`, item.cbmPerCtn, 6)}</row>`;
    }).join('');
    const endRow = Math.max(2, rows.length + 2);
    const hasWatermark = watermarkBytes instanceof Uint8Array && watermarkBytes.length > 0;
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:G${endRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A3" sqref="A3"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="19" customWidth="1"/><col min="2" max="2" width="52" customWidth="1"/><col min="3" max="3" width="27" customWidth="1"/><col min="4" max="4" width="10" customWidth="1"/><col min="5" max="6" width="16" customWidth="1"/><col min="7" max="7" width="15" customWidth="1"/></cols><sheetData>${header}${body}</sheetData><autoFilter ref="A2:G${endRow}"/><hyperlinks><hyperlink ref="A1" r:id="rId1" tooltip="Open your Buyer Room"/></hyperlinks><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" fitToHeight="0" orientation="portrait"/>${hasWatermark ? '<headerFooter><oddHeader>&amp;C&amp;G</oddHeader></headerFooter><legacyDrawingHF r:id="rId2"/><picture r:id="rId3"/>' : ''}</worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0000"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FF1264A3"/><u/><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0D7653"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const alignedStyles = styles.replace('formatCode="#,##0.00"', 'formatCode="0.00"')
      .replace(/(<xf numFmtId="(?:164|165)"[^>]*)(\/>)/g, '$1 applyAlignment="1"><alignment horizontal="right"/></xf>');
    const files = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasWatermark ? '<Default Extension="png" ContentType="image/png"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' : ''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="My Selection" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', sheet],
      ['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(url.toString())}" TargetMode="External"/>${hasWatermark ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/watermark.png"/>' : ''}</Relationships>`],
      ['xl/styles.xml', alignedStyles]
    ];
    if (hasWatermark) {
      files.push(['xl/media/watermark.png', watermarkBytes]);
      files.push(['xl/drawings/vmlDrawing1.vml', '<?xml version="1.0" encoding="UTF-8"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype><v:shape id="CH" o:spid="_x0000_s1025" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:180pt;width:440pt;height:440pt;z-index:1"><v:imagedata o:relid="rId1" o:title="FMCG Malaysia"/><o:lock v:ext="edit" rotation="t"/></v:shape></xml>']);
      files.push(['xl/drawings/_rels/vmlDrawing1.vml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/watermark.png"/></Relationships>']);
    }
    return zip(files);
  }

  async function prepareSelectionExcel(data) {
    const response = await fetch('./assets/logo-watermark-a4.png?v=20260923-a4');
    if (!response.ok) throw new Error('Excel watermark could not be loaded.');
    const bytes = buildSelectionExcel(data, new Uint8Array(await response.arrayBuffer()));
    const safeName = String(data.companyName || 'Buyer').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50) || 'Buyer';
    const date = new Date().toISOString().slice(0, 10);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return { customerId: data.customerId, fileName: `${safeName}-My-Selection-${date}.xlsx`, base64: btoa(binary) };
  }
  root.BuyerRoomExcel = { buildSelectionExcel, prepareSelectionExcel };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BuyerRoomExcel;
})(typeof globalThis !== 'undefined' ? globalThis : this);

