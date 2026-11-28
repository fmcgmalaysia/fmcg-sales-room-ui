const assert = require('node:assert/strict');
const fs = require('node:fs');

function addOpeningStockRelay(source) {
  const importLine = "import { getFinanceStockList } from 'backend/stockValuation.web';";
  const handlerLine = "    if(message.type==='FINANCE_STOCK_LIST_READ_REQUEST'){";
  assert.equal(source.split(importLine).length, 2);
  assert.equal(source.split(handlerLine).length, 2);
  const ending = source.includes('\r\n') ? '\r\n' : '\n';
  const importOpening = "import { getOpeningStockAccess, previewOpeningStock, postOpeningStock } from 'backend/openingStock.web';";
  const relay = [
    "    const openingKind = /^FINANCE_OPENING_STOCK_(ACCESS|PREVIEW|SAVE)_REQUEST$/.exec(message.type || '')?.[1];",
    "    if(openingKind){",
    "      const { company, requestId, input } = message;",
    "      if(!['NCT','GHR'].includes(company) || !/^[a-f0-9-]{36}$/i.test(requestId || '') || JSON.stringify(message).length > 2000) return;",
    "      const type = 'FINANCE_OPENING_STOCK_' + openingKind + '_RESULT';",
    "      try {",
    "        const result = openingKind === 'ACCESS' ? await getOpeningStockAccess(company) : openingKind === 'PREVIEW'",
    "          ? await previewOpeningStock(company, input?.barcode) : await postOpeningStock(company, requestId, input);",
    "        room.postMessage({ type, company, requestId, ok:result.ok !== false, result, error:result.error });",
    "      } catch (_) {",
    "        const error = openingKind === 'SAVE' ? 'Receipt unconfirmed. Retry the same save.' : 'Opening Stock is unavailable. Check Finance access or try again.';",
    "        room.postMessage({ type, company, requestId, ok:false, error });",
    "      }",
    "      return;",
    "    }"
  ].join(ending);
  return source.replace(importLine, () => importLine + ending + importOpening)
    .replace(handlerLine, () => relay + ending + handlerLine);
}

if (require.main === module) {
  const [, , input, output] = process.argv;
  fs.writeFileSync(output, addOpeningStockRelay(fs.readFileSync(input, 'utf8')), { flag: 'wx' });
}
module.exports = { addOpeningStockRelay };
