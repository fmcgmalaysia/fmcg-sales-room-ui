const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),evidence=process.argv[2];assert(evidence);
const normalize=value=>value.replace(/\r\n/g,'\n').trim();
const sha=value=>createHash('sha256').update(value).digest('hex');
const fnv=value=>{let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const backend=['staffManagementPolicy.js','staffManagement.web.js','staffAccessGateway.js','masterQuotationAccess.js','masterQuotation.web.js','ltposWorkspacePolicy.js','stockControl.web.js','warehouseReceiving.web.js','supportWorkroom.web.js','packingLists.web.js','customerFulfilment.web.js','accountPurchase.web.js','stockExceptions.web.js','warehouseStockIssues.web.js','stockValuation.web.js','taskChat.web.js','stockExceptionWorkspace.js'];
const entries=[...backend.map(name=>['MASTER',name,'integration/backend/'+name]),
 ['MASTER','ltpos-portal-page.js','integration/wix/ltpos-staff-portal-page.js'],['MASTER','staff-page.js','integration/wix/master-staff-management-page.js'],['MASTER','stock-control-page.js','integration/wix/stock-control-page.js'],
 ...['masterStaffAccessClient.js','staffAuth.web.js','catalogueSelection.web.js','catalogueAuth.web.js','masterWebQuotationData.js'].map(name=>['FMCG',name,'backend/'+name]),
 ['FMCG','onboarding.web.js','sales-room/wix/onboarding.web.js'],['FMCG','sales-page.js','sales-room/wix/sales-room-page.js'],['FMCG','catalogue-page.js','buyer-room/catalogue/wix/catalogue-page-v3.js'],['FMCG','buyer-page.js','buyer-room/wix/buyer-room-page.js'],['FMCG','sales-login-page.js','integration/wix/sales-room-login-page.js']];
const temp=path.join(evidence,'normalized');fs.mkdirSync(temp,{recursive:true});
const manifest=[];
for(const[site,name,file]of entries){
 const before=normalize(fs.readFileSync(path.join(evidence,'live',name),'utf8')),after=normalize(fs.readFileSync(path.join(root,file),'utf8'));
 assert.notEqual(before,after,name+' must have a scoped change');
 const baseFile=path.join(temp,name+'.before'),nextFile=path.join(temp,name+'.after');fs.writeFileSync(baseFile,before+'\n');fs.writeFileSync(nextFile,after+'\n');
 const result=cp.spawnSync('git',['diff','--no-index','--unified=3','--',baseFile,nextFile],{encoding:'utf8'});assert.equal(result.status,1,name);
 const chunks=result.stdout.split(/^@@ .*@@.*\n/gm).slice(1),headers=[...result.stdout.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm)];
 assert.equal(chunks.length,headers.length,name);
 const hunks=chunks.map((part,i)=>{
   const lines=part.replace(/\n$/,'').split('\n'),old=lines.filter(line=>line[0]===' '||line[0]==='-').map(line=>line.slice(1)).join('\n'),next=lines.filter(line=>line[0]===' '||line[0]==='+').map(line=>line.slice(1)).join('\n');
   assert(old.length>0&&before.split(old).length===2,name+': hunk must have unique captured context');
   return {line:Number(headers[i][1]),old,next};
 }).sort((a,b)=>b.line-a.line);
 let simulated=before;for(const hunk of hunks){assert.equal(simulated.split(hunk.old).length,2,name+': overlapping hunk context');simulated=simulated.replace(hunk.old,()=>hunk.next);}assert.equal(simulated,after,name+': exact reconstruction');
 manifest.push({site,name,file,before:{length:before.length,fnv:fnv(before),sha256:sha(before)},after:{length:after.length,fnv:fnv(after),sha256:sha(after)},hunks});
}
fs.writeFileSync(path.join(evidence,'wix-sync.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest.map(({site,name,before,after,hunks})=>({site,name,before:before.length+'/'+before.fnv,after:after.length+'/'+after.fnv,hunks:hunks.length}))));
