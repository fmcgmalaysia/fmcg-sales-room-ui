'use strict';
// Standalone Admin-only metadata reader. Not included in any business writer,
// bootstrap initializer, activation route, static Pages package or public relay.
const fs = require('node:fs'), path = require('node:path');
const { COHORT } = require('./isolated-cohort.cjs');
const { createFreshCohortActivationSchemaVerifier, activationAuditFields, targets, stable } = require('./fresh-cohort-activation-schema.cjs');
const source = [
  "import { collections } from '@wix/data';",
  "import { webMethod, Permissions } from 'wix-web-module';",
  "import { currentMember } from 'wix-members-backend';",
  "import { createHash } from 'crypto';",
  'const COHORT=' + JSON.stringify(COHORT) + ';',
  'const targets=Object.freeze(' + JSON.stringify(targets) + ');',
  'const activationAuditFields=Object.freeze(' + JSON.stringify(activationAuditFields) + ');',
  'const stable=' + stable.toString() + ';',
  createFreshCohortActivationSchemaVerifier.toString(),
  "async function authenticateAdmin(){const member=await currentMember.getMember({fieldsets:['FULL']});if(member?.status!=='APPROVED'||typeof member._id!=='string'||!member._id||member._id.length>200)throw Error('Actual approved administrator required');return{isAdmin:true,memberId:member._id};}",
  'const service=createFreshCohortActivationSchemaVerifier({collections,authenticateAdmin});',
  "export const inspectActivationAuditSchema=webMethod(Permissions.Admin,async input=>{const result=await service.inspect(input);console.info('R2ACTIVATION_SCHEMA_RECEIPT '+JSON.stringify(result));return result;});", ''
].join('\n');
if (require.main === module) {
  new Function(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
  const target = path.join(__dirname, 'r2activationSchema.web.js');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('R2 activation audit schema reader drift');
  } else fs.writeFileSync(target, source);
  process.stdout.write('R2 activation audit schema reader compiled: Admin metadata only; NOT installed or activation evidence\n');
}
module.exports = { source };
