'use strict';
const fs = require('node:fs'), path = require('node:path'), { delivery } = require('./source-intake-progress-backend.cjs');
const text = delivery(fs.readFileSync(path.join(__dirname, '../../../backend/nctSubmissionDelivery.js'), 'utf8').replace(/\r\n/g, '\n'));
new Function(text.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
const target = path.join(__dirname, 'nctSubmissionDelivery.candidate.js');
if (process.argv.includes('--check')) { if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== text) throw Error('Original Source intake progress delivery differs'); }
else fs.writeFileSync(target, text);
process.stdout.write('Original Source intake progress/lock overlay ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; not installed\n');
