const test=require('node:test'),assert=require('node:assert/strict');
const {recordedInvoice,patch}=require('../prototypes/finance-payable-confirmation-20261101/patch.cjs');
const inv=(extra={})=>({type:'INV',linked:true,fileId:'I',sha256:'H',declaredCents:1250000,...extra});
test('paid invoice with no final confirmation shows recorded invoice amount without creating a payable',()=>{const row={finance:{paidCents:625000,payableCents:null},documents:[inv()]},before=JSON.stringify(row),r=recordedInvoice(row);assert.equal(r.total,1250000);assert.equal(r.label,'Invoice total · unconfirmed');assert.equal(JSON.stringify(row),before);});
test('prepayment and missing invoice amounts are never used as the payable',()=>{assert.equal(recordedInvoice({finance:{paidCents:50000},documents:[]}).total,null);assert.equal(recordedInvoice({documents:[inv({declaredCents:undefined})]}).label,'Invoice amount not recorded');});
test('only current linked hashed INV values contribute, CN needs existing explicit reconciliation',()=>{assert.equal(recordedInvoice({documents:[inv(),inv({superseded:true}),inv({type:'CN',declaredCents:5000}),inv({linked:false})]}).total,1250000);assert.equal(recordedInvoice({documents:[inv({sha256:''})]}).confirmable,false);});
test('all current invoice amounts must be known and safe',()=>{assert.equal(recordedInvoice({documents:[inv(),inv({fileId:'B',declaredCents:null})]}).total,null);assert.equal(recordedInvoice({documents:[inv({declaredCents:Number.MAX_SAFE_INTEGER}),inv()]}).total,null);});
test('real production renderer exposes the existing amount-confirmation action while preserving confirmed payable',()=>{
 const vm=require('node:vm'),window={},baseline=require('../prototypes/two-site-closeout-20261102/stage.cjs').plan().assets;
 vm.runInNewContext(baseline.get('account-room/payment-layout.js').toString(),{window,Intl,Date,document:{addEventListener(){}}});
 const row={id:'PO',number:'PO',createdAt:'2026-10-31',supplierId:'S',documents:[inv()],history:[],warehouse:{},finance:{payableCents:null,paidCents:625000,balanceCents:null,payments:[]}};
 const render=()=>window.accountPaymentLayout.render({view:'creditor',company:'NCT',data:{orders:[row]},rows:[row],search:'',supplier:'',filter:'ACTIVE',stamp:x=>x,purchaseNote:()=>'',error:''});
 const html=render();assert.match(html,/12,500\.00/);assert.match(html,/Invoice total · unconfirmed/);assert.match(html,/data-settlement="amounts" data-po="PO"/);assert.match(html,/Net paid 6,250\.00/);assert.match(html,/Final balance pending confirmation/);
 row.finance.payableCents=1200000;row.finance.balanceCents=575000;const confirmed=render();assert.match(confirmed,/12,000\.00/);assert.doesNotMatch(confirmed,/Invoice total · unconfirmed|Confirm INV\/CN amounts/);
});
