'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),root=path.resolve(__dirname,'../../..'),baseline='6971fb1315f8ebc36f9814ce65ecb302f2db5397';
const files=[['purchase-live/task-grid.js','purchase-live/task-grid.js'],['purchase-live/app.js','purchase-live/app.js'],['integration/prototypes/receipt-feedback-20261026/purchase-live/active-layout.js','purchase-live/active-layout.js']];
const patches=files.map(([source,file])=>{
 const diff=cp.execFileSync('git',['diff','--no-ext-diff','--unified=1',baseline,'--',source],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n').split('\n'),hunks=[];let old=[],next=[],started=false;
 const finish=()=>{if(started){if(!old.length)throw Error('A patch must have a source anchor');hunks.push({find:old.join('\n')+'\n',replace:next.join('\n')+'\n'});}old=[];next=[];};
 for(const line of diff){if(line.startsWith('@@')){finish();started=true;continue;}if(!started||line.startsWith('\\'))continue;if(line[0]===' '){old.push(line.slice(1));next.push(line.slice(1));}else if(line[0]==='-')old.push(line.slice(1));else if(line[0]==='+')next.push(line.slice(1));}finish();return {file,hunks};
});
fs.writeFileSync(path.join(__dirname,'UI_PATCHES.json'),JSON.stringify({baseline:'6971fb1315f8ebc36f9814ce65ecb302f2db5397',patches},null,2)+'\n');
console.log('Prepared '+patches.reduce((n,row)=>n+row.hunks.length,0)+' isolated static hunks.');
