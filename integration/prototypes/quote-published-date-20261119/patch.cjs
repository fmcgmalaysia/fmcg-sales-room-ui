const assert = require('node:assert/strict');
function patchBuyerQuoteDate(html) {
  const before = "const updated=item.quoteActive?(item.quoteEffectiveAt||item.quoteSyncedAt||''):'';";
  const after = "const updated=item.quoteActive?(item.quotePublishedAt||(!/^WEB-\\d+$/.test(String(item.quoteEffectiveAt||''))&&item.quoteEffectiveAt)||item.quoteSyncedAt||''):'';";
  assert.equal(html.split(before).length, 2, 'Unexpected Buyer Room date source');
  html = html.replace(before, after);
  const empty = "${updated?esc(compactTime(updated)):'Waiting'}";
  assert.equal(html.split(empty).length, 2);
  return html.replace(empty, "${updated?esc(compactTime(updated)):item.quoteActive?'':'Waiting'}");
}
module.exports = { patchBuyerQuoteDate };
