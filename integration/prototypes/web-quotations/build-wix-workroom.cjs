const fs = require('node:fs');
const path = require('node:path');

const approved = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
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
  const render = section('function draftPrice(', 'function renderCatalogue(');
  const interaction = section('async function saveDraft(', "content.addEventListener('click'");
  const shared = replaceOnce(render + interaction, "const draftKey = context + '|' + row.id;", 'const draftKey = key(row.id);')
    .replaceAll('disabled || (!visible', 'disabled || current.canPublish === false || (!visible')
    .replaceAll('disabled || !quoteChanged(row)', 'disabled || current.canPublish === false || !quoteChanged(row)')
    .replaceAll(".disabled = !row.published?.enabled &&", ".disabled = current.canPublish === false || !row.published?.enabled &&")
    .replaceAll('update.disabled = !quoteChanged(row)', 'update.disabled = current.canPublish === false || !quoteChanged(row)')
    .replace('<div class="quote-actions quote-edits"><button', '<div class="quote-actions quote-edits">${quoteResumeButton(row)}<button');
  const output = [
    wixClient,
    replaceOnce(
      replaceOnce(
        replaceOnce(shared,
          "const placeholder = ({ '0999000000007': '🍪', '0999000000008': '🥫', '0999000000009': '🧴', '0999000000010': '🍪' })[row.barcode] || '—';",
          'const image = productImage(row.imageUrl);'),
        '<span class="demo-thumb" aria-label="Sample product icon">${placeholder}</span>', '${image}'),
      '<br><button data-go="catalogue">Open Catalogue</button>', '')
      .replaceAll("JSON.parse(localStorage.getItem('qa-quote-order:' + customerId()) || '[]')", "readStorage('order:' + scope(), [])")
      .replaceAll("localStorage.setItem('qa-quote-order:' + customerId(), JSON.stringify(ids))", "writeStorage('order:' + scope(), ids)")
  ].join('\n');

  const styles = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8') + '\n' +
    fs.readFileSync(path.join(__dirname, 'quote-grid.css'), 'utf8') +
    '\n.product-thumb{width:100%;height:35px;object-fit:contain;display:block} .empty-thumb{color:#64748b}';
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
