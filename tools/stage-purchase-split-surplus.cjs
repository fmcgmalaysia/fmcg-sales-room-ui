const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const site = path.resolve(process.argv[2], 'purchase-live');
const priorIndex = fs.readFileSync(path.join(site, 'index.html'));
const priorScript = fs.readFileSync(path.join(site, 'supplier-allocation.js'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(priorIndex) !== '40d8475f0f24d9ddd4b87441328a7c55a20b5473f17b8a5d316b6a21e42f942b' ||
    hash(priorScript) !== '17d083e031078a5cec7f2ab0862fe07600885592cf9ca791f7f7c8b3c9661773') {
  throw Error('The published Purchase page or supplier dialog does not match the release baseline.');
}

const prior = 'supplier-allocation.js?v=20261114-purchase-supplier-photo-preview-v1';
const versionedScript = 'supplier-allocation-20261124-split-surplus.js';
const source = priorIndex.toString('utf8');
if (source.split(prior).length !== 2) throw Error('The Purchase page needs review.');
fs.writeFileSync(path.join(site, 'index-20261124-split-surplus.html'), source.replace(prior, versionedScript), { flag: 'wx' });
fs.copyFileSync(path.join(__dirname, '../purchase-live/supplier-allocation.js'),
  path.join(site, versionedScript), fs.constants.COPYFILE_EXCL);
