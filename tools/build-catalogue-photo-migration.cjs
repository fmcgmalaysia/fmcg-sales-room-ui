const fs = require('node:fs');
const path = require('node:path');
const project = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(project,'backend',name),'utf8').replace(/\r\n/g,'\n');
const verify = read('catalogueImageAssets.js').split('export function createCataloguePreviewReader')[0];
const files = [verify,read('cataloguePhotoMigration.js'),read('cataloguePhotoMigrationAdmin.web.js')];
const imports = new Set();
const body = files.map((source,i) => {
  const content = source.replace(/^import .+ from '([^']+)';\n/gm,(line,from) => {
    if(!from.startsWith('./')) imports.add(line.trimEnd());
    return '';
  });
  return i<2 ? content.replace(/^export /gm,'') : content;
});
fs.writeFileSync(path.join(project,'handoff','cataloguePhotoMigrationAdmin.wix.js'),[...imports,...body].join('\n'));
