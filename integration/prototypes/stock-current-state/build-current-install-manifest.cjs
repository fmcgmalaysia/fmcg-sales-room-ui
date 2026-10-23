'use strict';
// Structural installation REVIEW packet only. It cannot grant writer coverage,
// synchronize Wix, change mode, infer live parity, or perform any business save.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {WRITERS}=require('./stock-admission.cjs');
const checkout=path.resolve(__dirname,'../../..'),relative=file=>path.relative(checkout,file).replace(/\\/g,'/');
const masterPatches=['accountPurchase.web','customerFulfilment','customerFulfilment.web','customerFulfilmentGateway','customerFulfilmentService',
 'nctReceiver','packingListModel','packingListOperations','packingLists.web','plannerAllocation','purchaseCostRetry.web','purchaseDisplayOrder',
 'purchaseOperations.web','purchaseOrders.web','purchaseProjection','purchaseQuantityProjection','purchaseQuantityRead','purchaseWorkspace.web',
 'stockCardProjection','stockControl.web','stockExceptions.web','warehousePreparation','warehouseReceiving.web'];
const masterNew=['stockCurrentAccountPurchase','stockCurrentBorrow.web','stockCurrentCommands','stockCurrentCostReference','stockCurrentExceptions',
 'stockCurrentFulfilment','stockCurrentOrderIntake','stockCurrentPacking','stockCurrentPurchaseOrders','stockCurrentQuantityRead','stockCurrentRead.web',
 'stockCurrentSourceSales','stockCurrentWarehouse.web','stockRecoveryRead.web','stockMaintenanceAdmin.web'];
const definition=()=>[...masterPatches.map(name=>({system:'MASTER',source:name+'.candidate.js',target:name+'.js',kind:'PATCH'})),
 ...masterNew.map(name=>({system:'MASTER',source:name+'.js',target:name+'.js',kind:'NEW'})),
 {system:'FMCGMALAYSIA',source:'nctSubmissionDelivery.candidate.js',target:'nctSubmissionDelivery.js',kind:'PATCH'}];
const writers={RECEIPT:['stockCurrentWarehouse.web.js'],ALLOCATION:['stockCurrentBorrow.web.js'],BORROWING:['stockCurrentBorrow.web.js'],
 SALES_DEMAND:['stockCurrentSourceSales.js'],PURCHASE_SOURCE:['stockCurrentBorrow.web.js'],PURCHASE_PLAN:['stockCurrentBorrow.web.js'],PURCHASE_TASK:['stockCurrentBorrow.web.js'],
 STOCK_EXCEPTION:['stockCurrentExceptions.js'],STOCK_RESOLUTION:['stockCurrentExceptions.js'],PACKING:['stockCurrentPacking.js'],
 WAREHOUSE_PREPARATION:['stockCurrentWarehouse.web.js'],SHIPMENT:['stockCurrentSourceSales.js','stockCurrentFulfilment.js'],
 ORDER_INTAKE:['stockCurrentOrderIntake.js'],ORDER_UPDATE:['stockCurrentSourceSales.js'],COST_REFERENCE:['stockCurrentCostReference.js','stockCurrentWarehouse.web.js'],
 MARGIN_REFERENCE:['stockCurrentBorrow.web.js','stockCurrentSourceSales.js'],SHIPMENT_PLAN:['stockCurrentSourceSales.js'],QUANTITY_CASE:['stockCurrentBorrow.web.js'],
 PURCHASE_ORDER_RECORD:['stockCurrentPurchaseOrders.js'],ACCOUNT_PURCHASE_RECORD:['stockCurrentAccountPurchase.js']};
function inspectInstall({entries=definition(),readFile=file=>fs.readFileSync(file,'utf8')}={}){
 const registry=new Map(),modules=new Map(),external=new Set(),errors=[],emptyCoverageRoots=[];
 const roots={MASTER:path.join(checkout,'integration/backend'),FMCGMALAYSIA:path.join(checkout,'backend')};
 const text=file=>readFile(file).replace(/\r\n/g,'\n'),digest=source=>createHash('sha256').update(source).digest('hex');
 const exportsOf=source=>{
  const names=new Set([...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class|var)\s+(\w+)/gm)].map(match=>match[1]));
  for(const match of source.matchAll(/^export\s*\{([^}]+)\}/gm))for(const item of match[1].split(',')){const parts=item.trim().split(/\s+as\s+/);if(parts[0])names.add(parts.at(-1));}
  return names;
 };
 for(const item of entries){
  if(!Object.hasOwn(roots,item.system)||!/^[A-Za-z][A-Za-z0-9.-]*\.js$/.test(item.target)||!/^[A-Za-z][A-Za-z0-9.-]*\.js$/.test(item.source)||!['PATCH','NEW'].includes(item.kind))throw Error('Explicit install source/target required');
  const key=item.system+'/'+item.target;if(registry.has(key))throw Error('Duplicate install target '+key);
  const source=text(path.join(__dirname,item.source)),originalPath=path.join(roots[item.system],item.target);
  const originalExists=fs.existsSync(originalPath);
  if(item.kind==='PATCH'&&!originalExists||item.kind==='NEW'&&originalExists)throw Error('Install target kind conflict '+key);
  registry.set(key,{...item,path:path.join(__dirname,item.source),sha256:digest(source),beforeSha256:originalExists?digest(text(originalPath)):null});
  if(/const writerCoverage\s*=/.test(source)){
   if(!/const writerCoverage\s*=\s*Object\.freeze\(\{\}\);/.test(source))errors.push('Unreviewed writer coverage activation '+key);else emptyCoverageRoots.push(key);
  }
 }
 for(const required of definition())if(!registry.has(required.system+'/'+required.target))errors.push('Required candidate omitted '+required.system+'/'+required.target);
 function visit(system,target){
  const key=system+'/'+target;if(modules.has(key))return modules.get(key);
  const installed=registry.get(key),file=installed?.path||path.join(roots[system],target);
  if(!fs.existsSync(file)){errors.push('Missing backend module '+key);return null;}
  const source=text(file),module={system,target,source:relative(file),sha256:digest(source),exports:[...exportsOf(source)].sort(),dependencies:[]};modules.set(key,module);
  for(const match of source.matchAll(/^import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?/gm)){
   const specifier=match[2];
   if(!specifier.startsWith('backend/')&&!specifier.startsWith('./')){external.add(specifier);continue;}
   const name=specifier.startsWith('backend/')?specifier.slice(8):specifier.slice(2),dependency=name.endsWith('.js')?name:name+'.js';
   if(!/^[A-Za-z][A-Za-z0-9.-]*\.js$/.test(dependency)){errors.push('Unreviewed backend path '+key+' -> '+specifier);continue;}
   module.dependencies.push(system+'/'+dependency);const other=visit(system,dependency);
   const named=match[1].match(/\{([^}]+)\}/);
   if(other&&named)for(const item of named[1].split(',')){const name=item.trim().split(/\s+as\s+/)[0];if(name&&!other.exports.includes(name))errors.push('Missing named export '+key+' -> '+system+'/'+dependency+':'+name);}
  }
  module.dependencies.sort();return module;
 }
 for(const item of registry.values())visit(item.system,item.target);
 // Explicit unchanged external entry points, not a scan of unrelated projects.
 visit('MASTER','http-functions.js');visit('MASTER','taskChat.web.js');
 if(Object.keys(writers).length!==WRITERS.length||WRITERS.some(name=>!Object.hasOwn(writers,name)))errors.push('Writer review map differs from mandatory admission');
 for(const [writer,targets] of Object.entries(writers))for(const target of targets)if(!registry.has('MASTER/'+target))errors.push('Missing writer candidate '+writer+' -> '+target);
 // Every publicly callable original Master web entry in this bounded backend must
 // be accounted for; unchanged chat has separate index-only writes, not stock.
 const webEntries=fs.readdirSync(roots.MASTER).filter(file=>file.endsWith('.web.js')).sort();
 for(const target of webEntries)if(target!=='taskChat.web.js'&&!registry.has('MASTER/'+target))errors.push('Unclassified original web entry MASTER/'+target);
 const guards=modules.get('MASTER/stockCurrentPacking.js');
 if(!guards?.dependencies.includes('MASTER/packingListModel.js')||!guards?.dependencies.includes('MASTER/packingListOperations.js'))errors.push('Paired packing model/reader missing');
 return{schema:'CURRENT_STOCK_INSTALL_REVIEW_V1',candidateOnly:true,activationAllowed:false,verifiedCoverage:false,
  baseline:'d447185987fecbb81bcaf6b25c170f631f767f9f',hashFormat:'SHA256_UTF8_LF',
  install:[...registry.values()].map(({path:_,...item})=>item).sort((a,b)=>(a.system+'/'+a.target).localeCompare(b.system+'/'+b.target)),
  modules:[...modules.values()].sort((a,b)=>(a.system+'/'+a.target).localeCompare(b.system+'/'+b.target)),externalDependencies:[...external].sort(),
  writerReview:Object.fromEntries(Object.entries(writers).map(([writer,targets])=>[writer,{targets,verified:false}])),
  unchangedEntryReview:{'MASTER/http-functions.js':'Original HTTP routes resolve patched intake/quantity/Sales modules; source secret/auth retained.',
   'MASTER/taskChat.web.js':'Separate DepartmentChatIndex/Drive messages; no stock/journal/task/PO writes. Not an actionable stock authority.'},
  emptyCoverageRoots:emptyCoverageRoots.sort(),errors,remainingGates:['Fresh exact live/repository comparison','Complete semantic writer/consumer review','Native schema/index/permissions/Date roundtrips',
   'Measured capacity and lifecycle','Safe operational recovery rehearsal','Maintenance migration and shadow parity','Focused implementation review','Four-stage release and user Loaded acceptance']};
}
if(require.main===module){
 const report=inspectInstall();if(report.errors.length){process.stderr.write(report.errors.join('\n')+'\n');process.exitCode=1;}
 else{const file=path.join(__dirname,'current-install-manifest.json'),serialized=JSON.stringify(report,null,2)+'\n';
  if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')!==serialized)throw Error('Install review hashes/graph changed');}else fs.writeFileSync(file,serialized);
  process.stdout.write('Candidate install review '+(process.argv.includes('--check')?'verified':'built')+': '+report.install.length+' targets, '+report.modules.length+' dependency modules, '+Object.keys(report.writerReview).length+' unverified writer categories; NOT activation or deployment\n');}
}
module.exports={inspectInstall,definition};
