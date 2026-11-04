'use strict';
// Distinct fixed scenario for the actual database roots' twenty-step policy.
// Does not replay/reseed either UNKNOWN test or the completed ten-step scenario.
const fs=require('node:fs'),path=require('node:path');
function buildR2RuntimeAcceptance(source){
 const replacements=[['SPT-R2CAS-20261024-6d31:','SPT-R2CAS20-20261024-73b4:'],
  ['stepsPerInvocation:10','stepsPerInvocation:20'],['++counts.patches>14','++counts.patches>24'],
  ['export const verifyR2Cas=','export const verifyR2Runtime=']];
 if(!source.includes('const NATIVE_R2_CAS_ACCEPTANCE_ENABLED=false;'))throw Error('Closed source required');
 for(const[before,after]of replacements){if(source.split(before).length!==2)throw Error('Exact runtime acceptance anchor required');source=source.replace(before,after);}
 return source;
}
const source=buildR2RuntimeAcceptance(fs.readFileSync(path.join(__dirname,'r2CasAcceptance.web.js'),'utf8').replace(/\r\n/g,'\n'));
if(require.main===module){
 new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
 const file=path.join(__dirname,'r2CasRuntimeAcceptance.web.js');
 if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Runtime acceptance drift');}
 else fs.writeFileSync(file,source);
 process.stdout.write('R2 twenty-step runtime acceptance compiled CLOSED, no delete capability\n');
}
module.exports={buildR2RuntimeAcceptance,source};
