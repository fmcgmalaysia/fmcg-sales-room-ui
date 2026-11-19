'use strict';
// A separate, initially closed diagnostic identity. The interrupted original
// request, its records and its mutation gate are never changed or resumed.
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const originalPrefix = 'SPT-COMMIT300-20261023-b19d:';
const prefix = 'SPT-R2CAPACITY-20261024-9e72:';
function buildR2CapacityAcceptance(source) {
  if (typeof source !== 'string' || source.split(originalPrefix).length !== 2
    || source.split('export const verifyStock300Commit=').length !== 2
    || source.split('const NATIVE_TEST_LOCK_RELEASE_GRANTED=false;').length !== 2) {
    throw Error('Exact closed diagnostic source required');
  }
  return source.replace(originalPrefix, prefix)
    .replace('export const verifyStock300Commit=', 'export const verifyR2CapacityAcceptance=');
}
function build() {
  const source = fs.readFileSync(path.join(__dirname, 'stockProtocol300Commit.web.js'), 'utf8').replace(/\r\n/g, '\n');
  const output = buildR2CapacityAcceptance(source);
  return { source: output, sha256: createHash('sha256').update(output).digest('hex'), prefix,
    collection: 'StockProtocolTest', lockReleaseEnabled: false,
    isolatedExecutorOnly: true, businessActivationAllowed: false };
}
if (require.main === module) {
  const result = build(), target = path.join(__dirname, 'r2CapacityAcceptance.web.js');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== result.source) throw Error('R2 capacity diagnostic drift');
  } else fs.writeFileSync(target, result.source);
  process.stdout.write(JSON.stringify({ ...result, source: undefined }) + '\n');
}
module.exports = { build, buildR2CapacityAcceptance, prefix };
