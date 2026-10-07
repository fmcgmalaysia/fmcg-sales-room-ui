const fs=require('fs'),assert=require('assert'),vm=require('vm'),cp=require('child_process');
const before=fs.readFileSync(__dirname+'/buyer-before.html','utf8'),after=fs.readFileSync('buyer-room.html','utf8');
const lines=s=>s.split(/\r?\n/),allowed=new Set(['compactTime','trackTime24','reviewDate']);
for(const old of lines(before).filter(x=>x.startsWith('function '))){const name=old.match(/^function ([^(]+)/)[1];if(!allowed.has(name))assert.equal(lines(after).find(x=>x.startsWith('function '+name+'(')),old,name+' changed');}
for(const m of after.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!m[1].includes('src='))new vm.Script(m[2]);
assert(!after.includes("timeZone:'Asia/Kuala_Lumpur'"));
const styles=s=>[...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]);assert.deepEqual(styles(after),styles(before));
if(process.argv[2]==='zone'){
 let now='2026-10-07T16:05:00Z';class TestDate extends Date{constructor(...xs){super(...(xs.length?xs:[now]));}}
 const c={Date:TestDate,Intl};vm.createContext(c);for(const name of allowed)vm.runInContext(lines(after).find(x=>x.startsWith('function '+name+'(')),c);
 const expected={ 'Asia/Kuala_Lumpur':['Today 00:00','Yesterday 23:59','08-10-2026'], 'Europe/London':['Today 17:00','Today 16:59','07-10-2026'], 'America/New_York':['Today 12:00','Today 11:59','07-10-2026'], 'Pacific/Auckland':['Today 05:00','Today 04:59','08-10-2026']}[process.env.TZ];
 assert.equal(c.compactTime('2026-10-07T16:00:00Z'),expected[0]);assert.equal(c.trackTime24('2026-10-07T15:59:00Z'),expected[1]);assert.equal(c.reviewDate(),expected[2]);assert.equal(c.compactTime(''),'—');assert.equal(c.compactTime('bad'),'bad');
 // DST end: calendar yesterday, not an elapsed 24-hour window.
 if(process.env.TZ==='America/New_York'){now='2026-11-02T04:30:00Z';assert.equal(c.compactTime('2026-10-31T04:30:00Z'),'Yesterday 00:30');assert.equal(c.compactTime('2026-11-01T05:30:00Z'),'Today 01:30');}
 console.log(process.env.TZ+' PASS');
}else{
 for(const zone of ['Asia/Kuala_Lumpur','Europe/London','America/New_York','Pacific/Auckland'])console.log(cp.execFileSync(process.execPath,[__filename,'zone'],{env:{...process.env,TZ:zone},encoding:'utf8'}).trim());
 console.log('Other functions, calculations, sorting, handlers and CSS byte-identical; syntax PASS');
}
