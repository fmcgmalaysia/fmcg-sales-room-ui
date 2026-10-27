'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../..'),baseline=process.env.MASTER_BASELINE_DIR;
if(!baseline)throw Error('MASTER_BASELINE_DIR required');
const entries=[{file:'master-shared/task-chat.js',name:'time',formatter:'chatTimeFormat'},{file:'support-room/workroom.js',name:'day',formatter:'supportDayFormat'}];
const inputs=[undefined,null,'',false,0,'not a date','2026-10-27','2026-10-27T15:59:59Z','2026-10-27T16:00:00Z','2026-12-31T23:59:59Z','2027-01-01T00:00:00Z','2028-02-29','2026-02-30','2026-13-01','2000-01-01T00:00:00+08:00'];
function evaluate(root,entry){
 const source=fs.readFileSync(path.join(root,entry.file),'utf8'),lines=source.split(/\r?\n/),body=lines.find(line=>line.trim().startsWith('const '+entry.name+'=')),setup=lines.find(line=>line.trim().startsWith('const '+entry.formatter+'='))||'';
 assert.ok(body,'Formatter function must be present');
 let constructors=0;const trackedIntl={DateTimeFormat:function(...args){constructors++;return new Intl.DateTimeFormat(...args);}};
 const fn=Function('Intl',setup+'\n'+body+'\nreturn '+entry.name+';')(trackedIntl),outputs=inputs.map(value=>{try{return {value:fn(value)};}catch(error){return {error:error.name};}});
 for(let i=0;i<100;i++)fn('2026-10-27T16:00:00Z');
 return {outputs,constructors};
}
const results=entries.map(entry=>{const before=evaluate(baseline,entry),after=evaluate(repo,entry);assert.deepEqual(after.outputs,before.outputs);assert.equal(after.constructors,1);assert.ok(before.constructors>=100);return {file:entry.file,edgeCases:inputs.length,outputsExact:true,repeatedRows:100,baselineFormatterConstructions:before.constructors,candidateFormatterConstructions:after.constructors};});
const report={results,realExternalRequests:0};if(process.env.MASTER_EFFICIENCY_RESULT)fs.writeFileSync(process.env.MASTER_EFFICIENCY_RESULT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
