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
  ).replace('function renderQuotes()', 'function renderQuotes(scrollPosition)')
    .replace('<div class="table-wrap quote-grid"><table>',
      '<div class="table-wrap quote-grid" tabindex="0" role="region" aria-label="Quotation products"><table aria-rowcount="${rows.length + 2}">')
    .replace("<tbody>${rows.map((row, index) => quoteRow(row, index + 1)).join('')}</tbody>",
      '<tbody>${initialQuoteRows(rows)}</tbody>')
    .replace('</div>`);\n}', '</div>`);\n  mountQuoteRows(rows, scrollPosition);\n}');
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
    .replace('const previous = row.previousSp;', 'const previous = row.lastSale;')
    .replaceAll('draftPrice(row)', 'sellingPrice(row)')
    .replace('target ? draftPrice(row, target)', 'target ? calculatorPrice(row, target)')
    .replace('const price = draftPrice(row, next);', 'const price = calculatorPrice(row, next);')
    .replace("editPrice(row, tr, { mode: 'EA', value });", "editPrice(row, tr, { mode: 'EA', value: value === null ? null : roundCents(value) });")
    .replaceAll('(!price || row.costMyr === null)', '!Number.isFinite(price?.gp)')
    .replace('target?.mode === \'EA\' ? inputValue(target.value) : suggestion ? fixed(suggestion.priceEa)', 'suggestion ? fixed(suggestion.priceEa)')
    .replace(/<input aria-label="Target unit price[^\n]+?\$\{disabled \? 'disabled' : ''\}>/,
      '<output class="calc-selling" aria-label="Target unit price for ${desc}" data-calculated-selling>${suggestion ? fixed(suggestion.priceEa) : \'0.00\'}</output>')
    .replace("const other = tr.querySelector(`[data-calc=${next.mode === 'GP' ? 'EA' : 'GP'}]`);", "const other = tr.querySelector('[data-calculated-selling]');")
    .replace("const calculated = next.mode === 'GP' ? price?.priceEa : price?.gp;", 'const calculated = price?.priceEa;')
    .replace("other.value = Number.isFinite(calculated) ? next.mode === 'GP' ? fixed(calculated) : Math.round(calculated) : '';", "other.value = Number.isFinite(calculated) ? fixed(calculated) : '0.00';")
    .replace('data-calc="GP" type="number" step="1" placeholder="0%"', 'data-calc="GP" type="number" step="1" placeholder="0"')
    .replace('<input aria-label="Target margin', '<label class="calc-margin"><input aria-label="Target margin')
    .replace('${disabled ? \'disabled\' : \'\'}></td>\n    <td class="calc-cell"><span class="mobile-label">Selling', '${disabled ? \'disabled\' : \'\'}><span aria-hidden="true">%</span></label></td>\n    <td class="calc-cell"><span class="mobile-label">Selling')
    .replace('<tr data-row="${escapeHtml(row.id)}"', '<tr aria-rowindex="${number + 2}" data-row="${escapeHtml(row.id)}"')
    .replace(/    <td class="move-cell">[^\n]+\n/, '')
    .replace('[24, 34, 35, \'\', 77, 86, 72, 70, 73, 66, 156, 89, 45, 48, 42]', '[42, 62, \'\', 74, 94, 91, 82, 77, 75, 142, 72, 53, 56, 49]')
    .replaceAll('<small>MYR</small>', '')
    .replace('<small>MYR · CTN</small>', '')
    .replace('class="quote-left" rowspan="2">Selling Price', 'class="quote-right" rowspan="2">Selling Price')
    .replace('rowspan="2">List Cost', 'class="quote-right" rowspan="2">List Cost')
    .replace('rowspan="2">Disc</th>', 'rowspan="2">Discount</th>')
    .replace('rowspan="2">Net Cost', 'class="quote-right" rowspan="2">Net Cost')
    .replace('Net cost · MYR per CTN', 'Net cost per CTN')
    .replace('<div class="product-name">${desc}</div>', '<div class="product-name" title="${desc}">${desc}</div>')
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

  const masterTheme = fs.readFileSync(path.join(__dirname, '../../../master-shared/workroom-theme.css'), 'utf8');
  const masterFonts = masterTheme.match(/@font-face\{font-family:'Purchase Dashboard Inter';[^}]+\}/g);
  if (masterFonts?.length !== 4) throw Error('Review the current MASTER workroom fonts.');
  const styles = masterFonts.join('\n') + '\n' + fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8') + '\n' +
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
