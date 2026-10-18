const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../account-room/purchase-payments.js'),'utf8'),fn=source.slice(source.indexOf(' function purchaseNote('),source.indexOf(' function render('));
const ctx={esc:v=>String(v??'').replaceAll('<','&lt;'),stamp:()=> 'SAVED TIME'};vm.runInNewContext(fn+';this.note=purchaseNote;',ctx);
test('Account shows the green logistics marker before the unchanged purchaser message, with no marker on delivery or unknown',()=>{
 const history=[{action:'PAYMENT_CHASE_CHANGED',result:'SAVED',changes:{after:{chasePayment:true}},message:'<Reminder>',actor:'BUYER',time:'2026-10-18T00:00:00Z'}];
 const self=ctx.note({selfCollect:true,history});assert.match(self,/acc-self-collect/);assert.ok(self.indexOf('Self Collect')<self.indexOf('&lt;Reminder>'));assert.match(self,/BUYER · SAVED TIME/);
 for(const selfCollect of [false,undefined]){const html=ctx.note({selfCollect,history});assert.doesNotMatch(html,/Self Collect|acc-self-collect/);assert.match(html,/&lt;Reminder>/);}
 assert.doesNotMatch(ctx.note({selfCollect:true}),/No note yet/);assert.match(ctx.note({}),/No note yet/);
});
