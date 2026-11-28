const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const baseline = require('./finance-outlook-layout-pages-base.json');
const previousBuild = '20261128-finance-inventory-outlook-v2';
const build = '20261129-finance-outlook-layout-v1';
const source = new URL('https://fmcgmalaysia.github.io/fmcg-sales-room-ui/');
const htmlPath = 'account-room/index.html';
const assets = ['account-room/inventory-outlook.css', 'account-room/inventory-outlook.js'];
const hash = data => createHash('sha256').update(data).digest('hex');

async function run(input, output) {
  if (!input || !output) throw Error('Provide the verified local Pages baseline or stage-live, and a new output directory.');
  const files = Object.entries(baseline);
  for (let offset = 0; offset < files.length; offset += 8) {
    await Promise.all(files.slice(offset, offset + 8).map(async ([name, expected]) => {
      let data;
      if (input === 'stage-live') {
        const response = await fetch(new URL(name,source), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000) });
        assert.ok(response.ok, `${name} HTTP ${response.status}`);
        data = Buffer.from(await response.arrayBuffer());
      } else {
        data = fs.readFileSync(path.join(input,name));
      }
      assert.equal(hash(data), expected, name);
      if (name === htmlPath) {
        const html = data.toString();
        assert.equal(html.split(previousBuild).length, 4, 'Expected exactly the previous Finance marker and two asset references');
        data = Buffer.from(html.replaceAll(previousBuild, build));
      }
      if (assets.includes(name)) data = fs.readFileSync(path.join(__dirname,'..',name));
      const target = path.join(output,name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data, { flag: 'wx' });
    }));
  }
  console.log(`${build} · three Outlook assets updated · ${files.length - 3} Pages assets preserved byte for byte`);
}

run(...process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
