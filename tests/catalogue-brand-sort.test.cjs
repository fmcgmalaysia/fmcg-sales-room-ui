const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalogue = fs.readFileSync(path.join(root, 'buyer-room/catalogue/wix/catalogue-page-v3.js'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'point-base/POINTBASE_WIX_SYNC_V2.gs'), 'utf8');
function catContext() {
 const context = vm.createContext({ console, $w: Object.assign(() => {}, { onReady() {} }) });
 vm.runInContext(catalogue.replace(/^import .*$/gm, ''), context);
 return context;
}
function syncContext() { const context = vm.createContext({ console }); vm.runInContext(sync, context); return context; }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
test('brand first; numeric sort inside brand; no item-name ordering; stable ties and missing values', () => {
 const c = catContext();
 c.items = [
 {id:'b10',brandName:'B',sortNo:'FO-10',name:'AAA'},
 {id:'a2',brandName:'a',sortNo:'2',name:'ZZZ'},
 {id:'b2',brandName:'b',sortNo:'FO-2',name:'ZZZ'},
 {id:'a1',brandName:'A',sortNo:'1',name:'YYY'},
 {id:'tie',brandName:'a',sortNo:'2',name:'AAA'},
 {id:'missing-sort',brandName:'A',sortNo:''},
 {id:'missing-brand',brandName:'',sortNo:'0'} ];
 assert.deepEqual(plain(vm.runInContext('sortCatalogueProducts(items).map(x=>x.id)',c)), ['a1','a2','tie','missing-sort','b2','b10','missing-brand']);
 assert.equal(c.items[0].id,'b10');
});
test('reads real CMS brand and Point Base sort ID without treating principle as brand', () => {
 const c=catContext(); c.input={_id:'id',name:'Product',brandName:' MILO ',principle:'NESTLE',pointBaseSortId:'FO-12',sortNo:'wrong',price:24,barcode:'0955001'};
 vm.runInContext('imageUrl = x=>x; catalogueReferenceIds = x=>x||[]; catalogueUnitPrice = ()=>0;', c);
 const p=plain(vm.runInContext('catalogueProductRecord(input)',c));
 assert.equal(p.brandName,'MILO'); assert.equal(p.principle,'NESTLE'); assert.equal(p.sortNo,'FO-12'); assert.equal(p.barcode,'0955001'); assert.equal(p.ea,'24');
});
test('search continues to reset the full product source and rejects stale category responses', () => {
 const search=catalogue.slice(catalogue.indexOf('const applySearch'),catalogue.indexOf('const applySearch')+1500);
 assert.match(search,/catalogueWorkspaceProducts = \[\.\.\.catalogueWorkspaceAllProducts\]/);
 assert.match(search,/catalogueWorkspaceQueryVersion \+= 1/);
 assert.match(search,/sendCatalogueWorkspaceData\(\)/);
 assert.match(catalogue,/queryVersion !== catalogueWorkspaceQueryVersion/);
});
function sourceRow(brand='MILO') { return {sheet:'FOOD',row:3,barcode:'0955001',status:'ACTIVE', values:{principle:'NESTLE',brand,name:'Product',packing:'500ml x24',ea:24,cbm:0.1234,netWeight:12,origin:'MY',shelfLife:'12M',innerBarcode:'',cartonBarcode:'',sortNo:'FO-12'}}; }
test('matched products only add brand; write allowlist permits it and preserves protected fields', () => {
 const c=syncContext(); c.row=sourceRow();
 const desired=plain(vm.runInContext('pbwManagedData_(row,false,true)',c));
 c.current={...desired}; delete c.current.brandName; c.current.image='original-image'; c.current.mainCategory='Food'; c.current.subCategories=['existing'];
 const mods=plain(vm.runInContext('pbwMods_(pbwManagedData_(row,false,true),current)',c));
 assert.deepEqual(mods,[{fieldPath:'brandName',action:'SET_FIELD',setFieldOptions:{value:'MILO'}}]);
 c.batch=[{fieldModifications:mods}]; vm.runInContext('pbwAssertPatchBatchSafe_(batch)',c);
 assert.equal(vm.runInContext('PBW.headers.brand',c),'BRAND NAME');
 assert.equal(vm.runInContext('PBW.fields.brand',c),'brandName');
 assert.equal(vm.runInContext('pbwAllowedFieldMap_(false).barcode',c),undefined);
 assert.equal(vm.runInContext('pbwAllowedFieldMap_(false).image',c),undefined);
 assert.equal(vm.runInContext('pbwAllowedFieldMap_(false).mainCategory',c),undefined);
 assert.equal(vm.runInContext('pbwAllowedFieldMap_(false).subCategories',c),undefined);
 c.batch=[{fieldModifications:[{fieldPath:'image',action:'SET_FIELD',setFieldOptions:{value:'replacement'}}]}];
 assert.throws(()=>vm.runInContext('pbwAssertPatchBatchSafe_(batch)',c), /Unsafe PATCH field/);
});
test('blank source brands retain existing values; inserts accept brand without optional blanks', () => {
 const c=syncContext(); c.row=sourceRow(''); c.current={brandName:'Existing Brand'};
 assert.deepEqual(plain(vm.runInContext('pbwMods_(pbwManagedData_(row,false,true),current).filter(x=>x.fieldPath==="brandName")',c)),[]);
 c.row=sourceRow(); const inserted=plain(vm.runInContext('pbwManagedData_(row,true,false)',c));
 assert.equal(inserted.brandName,'MILO'); assert.equal(inserted.barcode,'0955001'); assert.equal(inserted.innerBoxBarcode,undefined);
});
test('duplicate CMS barcodes still block writes; Wix-only items stay outside the plan', () => {
 const c=syncContext(); c.row=sourceRow(); c.source={rows:[c.row],report:[],nonEmptyRows:1,invalidRows:0,duplicateRows:0,globalIssues:0,duplicateGroups:0};
 c.cms=[{id:'one',data:{barcode:'0955001'}},{id:'two',data:{barcode:'0955001'}},{id:'wix-only',data:{barcode:'0999999',brandName:'Original'}}];
 const plan=plain(vm.runInContext('pbwPlan_(source,cms)',c));
 assert.equal(plan.summary.cmsDuplicateGroups,1); assert.ok(plan.summary.globalBlockers>0); assert.equal(plan.patches.length,0); assert.equal(plan.inserts.length,0);
});

