'use strict';
// Isolated comparison only: reads versioned source and synthetic facts; no network or CMS.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const baseline='080d3578fbddc0995938a08d452828cc24e12f6d',candidate='39bf0674694069cab05a511d414cea1e24a1cbd1';
function versionModule(revision,name,cache={}){
 if(cache[name])return cache[name];
 assert(/^[\w.-]+\.js$/.test(name));
 let source=cp.execFileSync('git',['show',revision+':integration/backend/'+name],{cwd:root,encoding:'utf8',maxBuffer:2000000});
 const bindings={};
 source=source.replace(/^import \{([^}]+)\} from '([^']+)';\r?$/gm,(_,names,target)=>{
  assert(target.startsWith('backend/')||['crypto','buffer'].includes(target),'External dependency excluded');
  const exports=target.startsWith('backend/')?versionModule(revision,target.slice(8),cache):require(target);
  for(const part of names.split(',')){const [original,alias]=part.trim().split(/\s+as\s+/);bindings[alias||original]=exports[original];}return '';
 });
 const names=[...source.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(match=>match[1]);
 cache[name]=vm.runInNewContext('(function(){'+source.replace(/^export /gm,'')+'\nreturn {'+names.join(',')+'};})()', {...bindings,Date,JSON,Error,Object,Array,Number,Promise,Set,Map,String,Math});
 return cache[name];
}
function receipt(quantity){return {hasPhysicalReceipt:true,accepted:quantity,stock:{availablePhysical:quantity,usableReceived:quantity,cases:[]}};}
function context(mainReceived,extraReceived,{inc=mainReceived,physical=true}={}){
 const rootTask={id:'DEMAND',customerId:'CUSTOMER',orderId:'ORDER',sourceLineId:'LINE',barcode:'SYNTHETIC',name:'Synthetic item',packing:'24 x 1',ea:24,ord:100,requested:100,inc,transactionCurrency:'USD',netCostCtn:30,procurement:{customerCtn:mainReceived,totalCtn:mainReceived},warehouse:mainReceived?receipt(mainReceived):null};
 const source={...rootTask,id:'EXTRA-SOURCE',procurementSource:true,customerDemandTaskId:'DEMAND',inc:extraReceived,procurement:{customerCtn:extraReceived,totalCtn:extraReceived},warehouse:receipt(extraReceived)};
 if(!physical){if(rootTask.warehouse)rootTask.warehouse.hasPhysicalReceipt=false;source.warehouse.hasPhysicalReceipt=false;}
 const allocations=[...(mainReceived?[{sourceTaskId:'DEMAND',targets:[{taskId:'DEMAND',quantity:mainReceived}]}]:[]),...(extraReceived?[{sourceTaskId:'EXTRA-SOURCE',targets:[{taskId:'DEMAND',quantity:extraReceived}]}]:[])];
 const activity=allocations.map((row,index)=>({title:'ALLOC-'+index,imageAltText:row.sourceTaskId,action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',activityTime:'2026-10-29T00:00:00Z',details:{beforeRevision:'',targets:row.targets}}));
 return {company:'NCT',customers:[{id:'CUSTOMER',name:'Synthetic customer'}],tasks:[rootTask,source],allocations,activity};
}
const oldContext=versionModule(baseline,'packingListContext.js').projectPackingContext;
const newContext=versionModule(candidate,'packingListContext.js').projectPackingContext;
const cases=[
 {name:'additional supplier received95 while main demand receipt counter0',input:context(0,95),expected:[95,0]},
 {name:'main source50 plus additional source45',input:context(50,45),expected:[95,50]},
 {name:'existing test shape with demand counter already95',input:context(0,95,{inc:95}),expected:[95,95]},
 {name:'no physical receipt remains unavailable',input:context(0,95,{inc:95,physical:false}),expected:[0,0]}
];
const observations=cases.map(row=>{const before=oldContext(row.input).tasks.find(task=>task.taskId==='DEMAND'),after=newContext(row.input).tasks.find(task=>task.taskId==='DEMAND');assert.deepEqual([before.ready,after.ready],row.expected,row.name);return {scenario:row.name,sourcePhysical:row.input.tasks.reduce((sum,t)=>sum+(t.warehouse?.hasPhysicalReceipt?t.warehouse.stock.availablePhysical:0),0),demandReceiptCounter:row.input.tasks[0].inc,baselineReady:before.ready,candidateReady:after.ready,baselineReview:before.review,candidateReview:after.review};});
const report={at:new Date().toISOString(),environment:'ISOLATED_SYNTHETIC_VERSIONED_SOURCE_COMPARISON',baseline,candidate,networkRequests:0,productionWrites:0,productionRawContextCaptured:false,observations,identifiedCondition:'Candidate caps unanchored readyByBatch by task.inc. task.inc records the main demand row receipt counter and need not equal physical coverage from additional supplier sources. Baseline readyStockFor already accounts for those sources. The isolated graph reproduces95→0 and95→50.',productionAttribution:'Reproduces the observed symptom, but the exact production main/source receipt structure has not been captured; do not claim definitive production causation or apply a production fix before complete recovery.',next:'After approved static recovery, obtain the minimal real read context or visible receipt-source facts, validate source identity/cumulative Loaded and anchored batches, then make a separate minimal correction.'};
const output=path.join(root,'handoff/stock-loaded-contract-20261028/READY_REGRESSION_DIAGNOSTIC.json');
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({observations,productionWrites:0,networkRequests:0,productionRawContextCaptured:false}));

