'use strict';
const fs = require('node:fs'), path = require('node:path');
const { COHORT } = require('./isolated-cohort.cjs');
const { stable } = require('./fresh-cohort-activation-schema.cjs');
const { contracts, createFreshCohortReadPreflight } = require('./fresh-cohort-read-preflight.cjs');
const source = ["import { collections, items } from '@wix/data';",
  "import { webMethod, Permissions } from 'wix-web-module';",
  "import { currentMember } from 'wix-members-backend';", "import { createHash } from 'crypto';",
  'const COHORT=' + JSON.stringify(COHORT) + ';', 'const contracts=' + JSON.stringify(contracts) + ';',
  'const stable=' + stable.toString() + ';', createFreshCohortReadPreflight.toString(),
  "async function authenticateAdmin(){const member=await currentMember.getMember({fieldsets:['FULL']});if(member?.status!=='APPROVED'||typeof member._id!=='string'||!member._id||member._id.length>200)throw Error('Actual approved administrator required');return{isAdmin:true,memberId:member._id};}",
  'const service=createFreshCohortReadPreflight({collections,items,authenticateAdmin});',
  "export const inspectNativeReadPrerequisites=webMethod(Permissions.Admin,async input=>{const result=await service.inspect(input);console.info('R2_NATIVE_READ_PREFLIGHT_RECEIPT '+JSON.stringify(result));return result;});", ''].join('\n');
if (require.main === module) {
  new Function(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
  const target = path.join(__dirname, 'r2readPreflight.web.js');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('R2 native read preflight drift');
  } else fs.writeFileSync(target, source);
  process.stdout.write('R2 native read preflight compiled: Admin-only, metadata/query only; no business mutation or activation\n');
}
module.exports = { source };
