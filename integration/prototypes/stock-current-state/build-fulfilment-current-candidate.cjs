'use strict';
const fs = require('node:fs'), path = require('node:path');
const original = fs.readFileSync(path.join(__dirname, '../../backend/customerFulfilment.js'), 'utf8').replace(/\r\n/g, '\n');
const expression = 'readAllocations(context.activity)';
if (original.split(expression).length !== 4) throw Error('Exact original fulfilment allocation anchors changed');
const helper = "export const SHIPMENT_CURRENT_ALLOCATION_VERSION=2;\nfunction fulfilmentAllocations(context){if(context.stockAllocationView==='CURRENT_V2'){if(!Array.isArray(context.allocations))throw Error('Current shipment allocation view missing');return context.allocations;}return readAllocations(context.activity);}\n";
let candidate = original.split(expression).join('fulfilmentAllocations(context)');
candidate = candidate.replace('export function shipmentVersion(context)', helper + 'export function shipmentVersion(context)');
new Function(candidate.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
const target = path.join(__dirname, 'customerFulfilment.candidate.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== candidate) throw Error('Fulfilment current view differs');
} else fs.writeFileSync(target, candidate);
process.stdout.write('Original fulfilment current allocation seam ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; candidate only\n');
