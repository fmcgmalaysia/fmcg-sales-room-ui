const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
module.exports = async function loadDelivery() {
  const { buildNctSubmission } = await import('../../backend/nctSubmissionPayload.js');
  const source = fs.readFileSync(path.join(__dirname, '../../backend/nctSubmissionDelivery.js'), 'utf8');
  if (!source.includes("from 'backend/nctSubmissionPayload.js'")) throw Error('Expected Wix backend import path');
  const executable = source.replace(/^import .+;\r?\n/gm, '')
    .replace('export function createNctSubmissionDelivery', 'function createNctSubmissionDelivery');
  return vm.runInNewContext('(function(){' + executable + '\nreturn {createNctSubmissionDelivery};})()',
    { buildNctSubmission, Date, Map, Set, JSON, Number, Error });
};
