const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('Account no longer projects retired manual chase flags into messages; saved audit is retained',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../account-room/purchase-payments.js'),'utf8');
 const body=source.slice(source.indexOf(' function purchaseNote(row)'),source.indexOf(' function render(){'));
 const context={esc:x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),stamp:x=>x};vm.createContext(context);vm.runInContext(body,context);
 const row={chasePayment:true,history:[{action:'PAYMENT_CHASE_CHANGED',result:'SAVED',time:'2026-10-15',actor:'A',message:'Old',changes:{after:{chasePayment:true}}},{action:'PAYMENT_CHASE_CHANGED',result:'SAVED',time:'2026-10-16',actor:'<BUYER>',message:'Supplier reminder 供应商催促',changes:{after:{chasePayment:true}}},{action:'PAYMENT_CHASE_CHANGED',result:'FAILED',time:'2026-10-17',message:'Failed',changes:{after:{chasePayment:true}}}]};
 const html=context.purchaseNote(row);assert.equal(html,'');assert.equal(row.history[1].message,'Supplier reminder 供应商催促');assert.equal(row.history.length,3);assert.equal(context.purchaseNote({history:[]}), '');
});
