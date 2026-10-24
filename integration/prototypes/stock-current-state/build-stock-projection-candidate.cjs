'use strict';
// Mechanical one-line candidate overlay. Never writes original backend or Wix.
const fs = require('node:fs'), path = require('node:path');
const baseline = fs.readFileSync(path.join(__dirname, '../../backend/stockCardProjection.js'), 'utf8').replace(/\r\n/g, '\n');
const needle = '        const amount = line.sources.find(row => row.sourceTaskId === source.id)?.quantity || 0;';
if (baseline.split(needle).length !== 2) throw Error('Original stock projection movement anchor changed');
const candidate = baseline.replace(needle, needle + '\n        if (!amount) continue;');
const target = path.join(__dirname, 'stockCardProjection.candidate.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== candidate) throw Error('Projection candidate differs from one-line patch');
} else fs.writeFileSync(target, candidate);
process.stdout.write('Stock projection one-line candidate ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; no production edits\n');
