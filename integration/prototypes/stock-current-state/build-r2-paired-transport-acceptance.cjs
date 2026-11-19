'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createPairedTransportAcceptance}=require('./r2-paired-transport-acceptance.cjs');
const source=[
  "import { fetch } from 'wix-fetch';",
  "import { getSecret } from 'wix-secrets-backend';",
  "import { webMethod, Permissions } from 'wix-web-module';",
  createPairedTransportAcceptance.toString().replace(/\r\n/g,'\n'),
  'const inspect=createPairedTransportAcceptance({fetch,getSecret});',
  "export const inspectMasterTestTransport=webMethod(Permissions.Admin,async input=>{const result=await inspect(input);console.info('R2_PAIRED_TRANSPORT_RECEIPT '+JSON.stringify(result));return result;});",''
].join('\n');
if(require.main===module){
  new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
  const target=path.join(__dirname,'r2PairedTransportAcceptance.web.js');
  if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Paired transport inspector drift');}
  else fs.writeFileSync(target,source);
  process.stdout.write('Fixed Source-to-Master test-site read probe compiled; no business write or credential disclosure\n');
}
module.exports={source};
