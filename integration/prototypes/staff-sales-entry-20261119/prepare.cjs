const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const privateDir = 'C:/FMCG-WIX-LOCAL/handoff/staff-sales-access-20261119';
const read = file => fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').trim()+'\n';
const fingerprint = value => { let h=2166136261; value=value.trim(); for(let i=0;i<value.length;i++) h=Math.imul(h^value.charCodeAt(i),16777619)>>>0; return [value.length,h.toString(16)]; };
const portal = read(path.join(__dirname,'ltpos-portal.baseline.js'));
const from = "'https://www.fmcgmalaysia.com/sales-room'";
assert.equal(portal.split(from).length,2);
fs.writeFileSync(path.join(root,'integration/wix/ltpos-staff-portal-page.js'),portal.replace(from,"'https://www.fmcgmalaysia.com/sales-room-login'"));
const files = [
  ['staffAccessGateway','integration/backend/staffAccessGateway.js','staffAccessGateway.baseline.js'],
  ['staffManagementPolicy','integration/backend/staffManagementPolicy.js','staffManagementPolicy.baseline.js'],
  ['LTPOS','integration/wix/ltpos-staff-portal-page.js','ltpos-portal.baseline.js']
];
const sources=[];
for (const [name,file,baseline] of files) {
  const before=read(path.join(__dirname,baseline)),after=read(path.join(root,file));
  fs.writeFileSync(path.join(privateDir,name+'.candidate.js'),after);
  let diff='';
  try { diff=execFileSync('git',['diff','--no-index','--unified=0','--',path.join(__dirname,baseline),path.join(root,file)],{encoding:'utf8',stdio:['ignore','pipe','ignore']}); }
  catch(error){ assert.equal(error.status,1); diff=error.stdout; }
  const patches=[];let h;
  for(const line of diff.split(/\r?\n/)) {
    const m=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if(m){ if(h)patches.push(h); h={start:Number(m[1])+(m[2]==='0'?1:0),old:'',next:''}; }
    else if(h&&line.startsWith('-'))h.old+=line.slice(1)+'\n';
    else if(h&&line.startsWith('+'))h.next+=line.slice(1)+'\n';
  }
  if(h)patches.push(h);
  // Normalize the baseline's final newline without turning it into an editor hunk.
  for(const p of patches) if(p.old.trim()===p.next.trim()) { p.old=p.next=''; }
  const useful=patches.filter(p=>p.old||p.next).reverse();
  let trial=before;
  for(const p of useful){const lines=trial.split('\n'),count=p.old?p.old.split('\n').length-1:0;assert.equal(lines.slice(p.start-1,p.start-1+count).join('\n')+(count?'\n':''),p.old);lines.splice(p.start-1,count,...(p.next?p.next.slice(0,-1).split('\n'):[]));trial=lines.join('\n');}
  assert.equal(trial.trim(),after.trim());
  sources.push({name,file,before:fingerprint(before),after:fingerprint(after),patches:useful});
}
fs.writeFileSync(path.join(privateDir,'wix-transfer.json'),JSON.stringify({sources},null,2));
console.log(sources.map(({name,before,after,patches})=>({name,before,after,hunks:patches.length})));
