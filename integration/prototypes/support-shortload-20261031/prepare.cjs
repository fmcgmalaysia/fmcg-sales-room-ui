const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),files=['master-shared/desk-delivery.js','master-shared/desk-delivery.css','support-room/workroom.js','support-room/workroom-model.js'];
const patches=files.map(file=>{
 const diff=cp.execFileSync('git',['diff','--no-ext-diff','--unified=3','384659a','--',file],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n'),hunks=[];let current;
 for(const line of diff.split('\n')){if(line.startsWith('@@')){current={find:'',replace:''};hunks.push(current);}else if(current&&[' ','+','-'].includes(line[0])){if(line[0]!=='+')current.find+=line.slice(1)+'\n';if(line[0]!=='-')current.replace+=line.slice(1)+'\n';}}
 assert(hunks.length,file);return {file,hunks};
});fs.writeFileSync(path.join(__dirname,'UI_PATCHES.json'),JSON.stringify({baseline:'384659a',patches},null,2)+'\n');
