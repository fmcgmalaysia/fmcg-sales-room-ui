const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const workspacePath = path.join(root, 'buyer-room', 'catalogue', 'wix', 'catalogue-workspace-v1.html');
const conceptPath = 'C:/Users/User/.codex/visualizations/2026/09/22/01a0c830-d811-77b2-b80f-82c6987957c3/catalogue-orange-lively.html';
const outputPath = path.join(root, 'buyer-room', 'catalogue', 'preview', 'catalogue-workspace-v1.html');

const concept = fs.readFileSync(conceptPath, 'utf8');
const products = [...concept.matchAll(/data-name="([^"]+)" data-pack="([^"]+)" data-code="([^"]+)" data-image="([^"]+)"/g)]
  .slice(0, 8)
  .map((match, index) => ({
    id: `preview-${index + 1}`,
    name: match[1],
    description: match[2],
    barcode: match[3],
    image: match[4],
    principle: index < 6 ? 'NESTLÉ' : 'FMCG MALAYSIA',
    countryOrigin: 'MALAYSIA',
    shelfLife: '12 MONTHS',
    subCategoryIds: ['preview-food'],
    unitPrice: index === 0 ? 1.2 : null,
    currency: 'USD'
  }));

let html = fs.readFileSync(workspacePath, 'utf8');
const mock = JSON.stringify({
  type: 'catalogueWorkspaceData',
  products,
  selectedProductIds: ['preview-2', 'preview-5'],
  buyerRoomUrl: '#'
});
html = html.replace(
  "post('catalogueWorkspaceReady');",
  `post('catalogueWorkspaceReady');setTimeout(()=>window.postMessage(${mock},'*'),40);`
);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html);
console.log(outputPath);
