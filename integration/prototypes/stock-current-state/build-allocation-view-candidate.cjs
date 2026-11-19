'use strict';
// One-line prepare seam, default original history path unchanged. Candidate only.
const fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../backend/plannerAllocation.js'), 'utf8').replace(/\r\n/g, '\n');
const old = 'const prior=readAllocations(activity),old=prior.find(row=>row.sourceTaskId===source.id),shipments=';
const next = "const prior=workspace.stockAllocationView==='CURRENT_V2'?workspace.allocations:readAllocations(activity),old=prior.find(row=>row.sourceTaskId===source.id),shipments=";
if (source.split(old).length !== 2) throw Error('Original allocation prior anchor changed');
const marker = 'const qty=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;';
if (source.split(marker).length !== 2) throw Error('Original allocation quantity anchor changed');
const out = source.replace(old, next).replace(marker, marker + '\nexport const ALLOCATION_CURRENT_VIEW_VERSION = 2;'), target = path.join(__dirname, 'plannerAllocation.candidate.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== out) throw Error('Allocation current-view candidate differs');
} else fs.writeFileSync(target, out);
process.stdout.write('Original allocation CURRENT-view one-line candidate ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; no live edits\n');
