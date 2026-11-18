const fs = require('node:fs');
const path = require('node:path');

const approved = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const wixClient = fs.readFileSync(path.join(__dirname, 'wix-workroom-client.js'), 'utf8');

function section(from, to) {
  const start = approved.indexOf(from);
  const end = approved.indexOf(to, start);
  if (start === -1 || end === -1) throw Error('The approved quotation UI changed. Review its workroom adapter.');
  return approved.slice(start, end);
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error('The approved quotation UI changed. Review its workroom adapter.');
  return source.replace(before, () => after);
}

function buildWixWorkroom(destination) {
  const render = replaceOnce(
    section('function draftPrice(', 'function quoteRows(') + section('function renderQuotes(', 'function renderCatalogue('),
    "const search = $('#search').value.toLowerCase();\n  const rows = quoteRows().filter(row => [row.name, row.barcode, row.packing, row.costDetails?.remark].join(' ').toLowerCase().includes(search));",
    'const rows = quoteRows();'
  );
  const interaction = section('async function saveDraft(', 'function moveQuoteRow(');
  const shared = replaceOnce(render + interaction, "const draftKey = context + '|' + row.id;", 'const draftKey = key(row.id);')
    .replaceAll('disabled || (!visible', 'disabled || current.canPublish === false || (!visible')
    .replaceAll('disabled || !quoteChanged(row)', 'disabled || current.canPublish === false || !quoteChanged(row)')
    .replaceAll(".disabled = !row.published?.enabled &&", ".disabled = current.canPublish === false || !row.published?.enabled &&")
    .replaceAll('update.disabled = !quoteChanged(row)', 'update.disabled = current.canPublish === false || !quoteChanged(row)')
    .replace('<div class="quote-actions quote-edits"><button', '<div class="quote-actions quote-edits">${quoteResumeButton(row)}<button hidden')
    .replace('<button class="update primary" data-action="publish"', '<button hidden class="update primary" data-action="publish"')
    .replace('data-mode="EA" type="number" step="any"', 'data-mode="EA" type="number" step="any" placeholder="0.00"')
    .replace('value="${inputValue(price?.priceEa)}"', 'value="${price ? fixed(price.priceEa) : \'\'}"')
    .replace(".value = inputValue(price?.priceEa);", ".value = price ? fixed(price.priceEa) : '';")
    .replace(/    <td class="move-cell">[^\n]+\n/, '')
    .replace('[24, 34, 35,', '[34, 35,')
    .replace('<th rowspan="2" aria-label="Move"></th>', '');
  const output = [
    wixClient,
    replaceOnce(
      replaceOnce(
        replaceOnce(shared,
          "const placeholder = ({ '0999000000007': '🍪', '0999000000008': '🥫', '0999000000009': '🧴', '0999000000010': '🍪' })[row.barcode] || '—';",
          'const image = productImage(row.imageUrl);'),
        '<span class="demo-thumb" aria-label="Sample product icon">${placeholder}</span>', '${image}'),
      '<br><button data-go="catalogue">Open Catalogue</button>', '')
  ].join('\n');

  const styles = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8') + '\n' +
    fs.readFileSync(path.join(__dirname, 'quote-grid.css'), 'utf8') +
    '\n.product-thumb{width:100%;height:38px;object-fit:contain;display:block} .empty-thumb{color:#64748b}';
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'app.js'), output);
  fs.writeFileSync(path.join(destination, 'style.css'), styles);
  fs.copyFileSync(path.join(__dirname, 'wix-workroom.html'), path.join(destination, 'index.html'));
}

if (require.main === module) {
  if (!process.argv[2]) throw Error('Pass an explicit output directory.');
  buildWixWorkroom(path.resolve(process.argv[2]));
}

module.exports = { buildWixWorkroom };
