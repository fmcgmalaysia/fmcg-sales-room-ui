'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const previous=require('../master-closeout-display-20261031/stage.cjs'),build='20261031-purchase-origin-view-source-v1';
function once(text,from,to){assert.equal(text.split(from).length,2,from.slice(0,90));return text.replace(from,()=>to);}
let cached;
function plan(){
 if(cached)return cached;const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 let app=assets.get('purchase-live/app.js').toString();app=once(app,'allocations:data.allocations||[],allocationContext:data.allocationContext,shipmentPlans:','allocations:data.allocations||[],allocationContext:data.allocationContext,allocationOrigins:data.allocationOrigins,shipmentPlans:');assets.set('purchase-live/app.js',Buffer.from(app));
 let grid=assets.get('purchase-live/task-grid.js').toString();
 grid=once(grid,'allocations=[],allocationContext=null,deskDeliveries=[]','allocations=[],allocationContext=null,allocationOrigins=null,deskDeliveries=[]');
 grid=once(grid,'setContext({tasks,allocations,allocationContext,deskDeliveries,customers})','setContext({tasks,allocations,allocationContext,allocationOrigins,deskDeliveries,customers})');
 const old="        const problem=position?.quarantined===true,label=problem?'Stock review 库存待核对':loans.length?(loans.every(loan=>loan.outstanding===0)?'Borrowed · Repaid 借入已补回':'Borrowed Stock 借入库存'):replenished?'Replenished Stock 补回库存':'Ready Stock 现有库存';";
 const replacement="        const origin=loans.length?window.purchaseTaskInfo?.model(row.id,batch)?.sources.filter(item=>item.id===entry.sourceTaskId):null,known=origin?.length>0&&origin.every(item=>item.kind!=='Source')&&origin.reduce((sum,item)=>sum+item.quantity,0)===entry.quantity;\n        const borrowed=known&&origin.some(item=>item.kind==='Borrowed'),mixed=borrowed&&origin.some(item=>item.kind!=='Borrowed');\n        const problem=position?.quarantined===true,label=problem?'Stock review 库存待核对':loans.length?(!known?'Stock source 库存来源':mixed?'Mixed Stock 混合来源':borrowed?(loans.every(loan=>loan.outstanding===0)?'Borrowed · Repaid 借入已补回':'Borrowed Stock 借入库存'):'Ready Stock 现有库存'):replenished?'Replenished Stock 补回库存':'Ready Stock 现有库存';";
 grid=once(grid,old,replacement);assets.set('purchase-live/task-grid.js',Buffer.from(grid));
 let detail=assets.get('purchase-live/customer-allocation.js').toString();
 const fields="   const fields=[['Customer source 本客户来源',quantity(entry.quantity)+' CTN']";
 detail=once(detail,fields,"   const origin=loans.length?window.purchaseTaskInfo?.model(taskId,batchId,'',data)?.sources.filter(item=>item.id===sourceId):null,breakdown=origin?.length>0&&origin.reduce((sum,item)=>sum+item.quantity,0)===entry.quantity?origin:[];\n"+fields);
 const end="['Updated by 更新员工',entry.by||'']];";
 detail=once(detail,end,"['Updated by 更新员工',entry.by||''],...breakdown.map(item=>[item.kind+(item.repaid?' · Repaid':''),quantity(item.quantity)+' CTN'])];");assets.set('purchase-live/customer-allocation.js',Buffer.from(detail));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
 for(const script of ['app.js','task-grid.js','customer-allocation.js'])index=index.replace(new RegExp('('+script.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);
 assets.set('purchase-live/index.html',Buffer.from(index));
 return cached={assets,baseline,build,changed:[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file)};
}
function stage(destination){const target=path.resolve(destination||''),root=path.resolve(__dirname,'../../..');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);const result=plan();fs.mkdirSync(target,{recursive:true});for(const[file,bytes]of result.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const report={build,changed:result.changed,resources:[...result.assets].map(([file,bytes])=>({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})),backendFilesIncluded:false,recovery:'ca5ed1b static composition; Purchase original version reference preserved privately'};fs.writeFileSync(path.join(target,'purchase-origin-view-source-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build,changed:result.changed,resources:result.resources.length}));}
module.exports={plan,stage,build};
