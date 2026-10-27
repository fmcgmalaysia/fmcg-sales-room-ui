'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const expected=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),root='https://fmcgmalaysia.github.io/fmcg-sales-room-ui/';
(async()=>{
 const response=await fetch(root+'master-efficiency-release.json?verify='+expected.codeCommit,{cache:'no-store'});assert.equal(response.status,200,'Release metadata must be present');const actual=await response.json();assert.equal(actual.build,expected.build);assert.equal(actual.codeCommit,expected.codeCommit);assert.equal(actual.backendFilesIncluded,false);assert.deepEqual(actual.resources,expected.resources);
 const queue=[...expected.resources],results=[];
 await Promise.all(Array.from({length:6},async()=>{while(queue.length){const item=queue.shift(),r=await fetch(root+item.path+'?verify='+expected.codeCommit,{cache:'no-store'}),bytes=Buffer.from(await r.arrayBuffer());results.push({path:item.path,status:r.status,exact:r.ok&&crypto.createHash('sha256').update(bytes).digest('hex')===item.sha256});}}));
 const result={build:actual.build,codeCommit:actual.codeCommit,resources:results.length,exact:results.filter(row=>row.exact).length,mismatches:results.filter(row=>!row.exact),protectedResources:actual.protectedResources,backendFilesIncluded:actual.backendFilesIncluded};if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));assert.equal(result.exact,99);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
