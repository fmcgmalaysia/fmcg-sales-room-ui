const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function replace(text, old, next) { assert.equal(text.split(old).length, 2); return text.replace(old, () => next); }
function plan() {
  const previous = path.join(__dirname, '../verified-central-v16');
  // Reconstruct the freshly compared deployed v18 dispatcher; preserve its cost entry.
  let code = fs.readFileSync(path.join(previous, 'Code.gs'), 'utf8').replace(/\r\n/g, '\n');
  code = replace(code, "    const result = action === 'ADD_SELECTION'", "    const result = action === 'MASTER_CAPTURE_COST'\n      ? WIX_masterCaptureCost(payload)\n      : action === 'ADD_SELECTION'");
  const selection = fs.readFileSync(path.join(previous, 'RemoveSelection.gs'), 'utf8').replace(/\r\n/g, '\n');
  const patches = [
    { file: 'Code.gs', old: "      : action === 'ADD_SELECTION'", next: "      : action === 'RESOLVE_SELECTION_PRODUCT'\n        ? WIX_resolveSelectionProductReference(payload)\n        : action === 'ADD_SELECTION'" },
    { file: 'RemoveSelection.gs', old: 'qdRow: WIX_SELECTION_CFG.QD_DATA_START_ROW + index, idempotent: true', next: "qdRow: WIX_SELECTION_CFG.QD_DATA_START_ROW + index, unitBarcode: String(sheet.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW + index, headers['UNIT BARCODE']).getDisplayValue() || '').trim(), idempotent: true" },
    { file: 'RemoveSelection.gs', old: 'qdRow: row, idempotent: false', next: 'qdRow: row, unitBarcode: p.unitBarcode, idempotent: false' }
  ];
  const baseline = { 'Code.gs': code, 'RemoveSelection.gs': selection };
  const output = { ...baseline };
  for (const p of patches) output[p.file] = replace(output[p.file], p.old, p.next);
  output['SelectionProductReference.gs'] = fs.readFileSync(path.join(__dirname, 'SelectionProductReference.gs'), 'utf8').replace(/\r\n/g, '\n');
  return { baseline, output, patches, hashes: Object.fromEntries(Object.entries(output).map(([file, text]) => [file, hash(text)])) };
}
module.exports = { plan };
