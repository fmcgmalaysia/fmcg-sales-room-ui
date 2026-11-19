'use strict';
const fs=require('node:fs'),path=require('node:path'),source=fs.readFileSync(path.join(__dirname,'../../../sales-room/customer-documents.js'),'utf8').replace(/\r\n/g,'\n');
const candidate=require('./source-sales-document-ui-overlay.cjs')(source),target=path.join(__dirname,'customer-documents.candidate.js');new Function(candidate);
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==candidate)throw Error('Original customer document UI overlay differs');}else fs.writeFileSync(target,candidate);
process.stdout.write('Original Source document current request overlay '+(process.argv.includes('--check')?'verified':'built')+'; no publication\n');
