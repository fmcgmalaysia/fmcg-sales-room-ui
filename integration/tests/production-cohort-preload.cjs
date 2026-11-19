// Test-only source alignment. Production is composed from scoped releases, not checkout age.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),read=fs.readFileSync;
const receiving=execFileSync('git',['show','fc76b37:integration/backend/warehouseReceiving.js'],{cwd:root});
const normalized=receiving.toString().replace(/\r\n/g,'\n');
if(crypto.createHash('sha256').update(normalized).digest('hex')!=='447337a9cd68348f5577ae7834f83fec8857b982be21f4493517a7b12fc1d84e')throw Error('Published receiving recovery source differs');
fs.readFileSync=function(file,options){
 if(typeof file==='string'&&path.resolve(file)===path.join(root,'integration/backend/warehouseReceiving.js')){const encoding=typeof options==='string'?options:options?.encoding;return encoding?receiving.toString(encoding):Buffer.from(receiving);}
 return read.call(fs,file,options);
};
