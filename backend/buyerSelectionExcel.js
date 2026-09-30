const encoder = new TextEncoder();

const xml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
}[character]));

const cellText = (address, value, style = 0) =>
  `<c r="${address}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t>${xml(value)}</t></is></c>`;

const cellNumber = (address, value, style = 0) => value === null || value === undefined || value === ''
  ? `<c r="${address}"${style ? ` s="${style}"` : ''}/>`
  : `<c r="${address}"${style ? ` s="${style}"` : ''}><v>${Number(value)}</v></c>`;

const cellFormula = (address, formula, style = 0) =>
  `<c r="${address}"${style ? ` s="${style}"` : ''}><f>${xml(formula)}</f><v></v></c>`;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const append = bytes => { chunks.push(bytes); offset += bytes.length; };
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const bytes = content instanceof Uint8Array ? content : encoder.encode(content);
    const crc = crc32(bytes);
    const start = offset;
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    append(local);
    append(bytes);
    central.push({ nameBytes, bytes, crc, start });
  }
  const centralStart = offset;
  for (const file of central) {
    const entry = new Uint8Array(46 + file.nameBytes.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint32(16, file.crc, true);
    view.setUint32(20, file.bytes.length, true);
    view.setUint32(24, file.bytes.length, true);
    view.setUint16(28, file.nameBytes.length, true);
    view.setUint32(42, file.start, true);
    entry.set(file.nameBytes, 46);
    append(entry);
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, offset - centralStart, true);
  endView.setUint32(16, centralStart, true);
  append(end);
  const result = new Uint8Array(offset);
  let position = 0;
  for (const chunk of chunks) { result.set(chunk, position); position += chunk.length; }
  return result;
}

export function buildBuyerSelectionExcel(data) {
  const buyerRoomUrl = new URL(String(data?.buyerRoomUrl || ''));
  if (buyerRoomUrl.protocol !== 'https:') throw new Error('Buyer Room link is unavailable.');
  buyerRoomUrl.search = '';
  buyerRoomUrl.hash = '';
  const currency = String(data?.currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Transaction currency is unavailable.');
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) throw new Error('There are no products to export.');
  const headers = ['IMAGE URL', 'UNIT BARCODE', 'ITEM NAME', 'PACKING SIZE', 'EA', `${currency} UNIT PRICE`, 'EA × UNIT PRICE', 'CBM / CTN'];
  const stamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
  const heading = `<row r="1" ht="28" customHeight="1">${cellText('A1', 'Open Buyer Room', 1)}${cellText('C1', `Exported ${stamp} (MYT)`, 3)}</row>`
    + `<row r="2" ht="26" customHeight="1">${headers.map((value, index) => cellText(`${String.fromCharCode(65 + index)}2`, value, 2)).join('')}</row>`;
  const body = rows.map((item, index) => {
    const row = index + 3;
    const amountFormula = `IF(OR(E${row}="",F${row}=""),"",E${row}*F${row})`;
    return `<row r="${row}">${cellText(`A${row}`, item.imageUrl)}${cellText(`B${row}`, item.unitBarcode, 7)}`
      + `${cellText(`C${row}`, item.itemName)}${cellText(`D${row}`, item.packingSize)}${cellNumber(`E${row}`, item.ea, 4)}`
      + `${cellNumber(`F${row}`, item.unitPrice, 5)}${cellFormula(`G${row}`, amountFormula, 5)}${cellNumber(`H${row}`, item.cbmPerCtn, 6)}</row>`;
  }).join('');
  const endRow = rows.length + 2;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:H${endRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A3" sqref="A3"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="2" width="19" customWidth="1"/><col min="3" max="3" width="52" customWidth="1"/><col min="4" max="4" width="27" customWidth="1"/><col min="5" max="5" width="10" customWidth="1"/><col min="6" max="7" width="18" customWidth="1"/><col min="8" max="8" width="15" customWidth="1"/></cols><sheetData>${heading}${body}</sheetData><autoFilter ref="A2:H${endRow}"/><hyperlinks><hyperlink ref="A1" r:id="rId1" tooltip="Open your Buyer Room"/></hyperlinks><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" fitToWidth="1" fitToHeight="0" orientation="landscape"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0.0000"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFF15A2A"/><u/><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243B57"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="My Selection" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="0" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(buyerRoomUrl.toString())}" TargetMode="External"/></Relationships>`],
    ['xl/styles.xml', styles]
  ]);
}
