const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {purchaseDocumentName,purchaseDocumentState,purchaseInvoiceDueDate,purchaseArchiveEligible,PURCHASE_DOCUMENT_ROOTS}=load('purchaseDocumentPolicy.js');
test('file destination is fixed by company and document name keeps date/supplier/type/number',()=>{
 assert.equal(PURCHASE_DOCUMENT_ROOTS.NCT,'12gCZmqioYGZyRmgW3CsWyobBBcUnCFUS');assert.equal(PURCHASE_DOCUMENT_ROOTS.GHR,'18w4I96N3PSCTv2Qxs_mycy-PMu-lth9w');
 assert.equal(purchaseDocumentName({date:'2026-10-11',supplierShortName:'SUP A',type:'INV',number:'001/26'}),'2026-10-11 SUP A INV 001-26.pdf');
 assert.throws(()=>purchaseDocumentName({date:'2026-02-30',supplierShortName:'A',type:'INV',number:'1'}));
});
test('only linked current documents affect red/orange/green and CN cannot pretend to be an invoice',()=>{
 assert.equal(purchaseDocumentState([{type:'INV',fileId:'I',linked:false}],true),'MISSING');
 assert.equal(purchaseDocumentState([{type:'CN',fileId:'C',linked:true}],true),'MISSING');
 assert.equal(purchaseDocumentState([{type:'SO',fileId:'S',linked:true}]),'PROVISIONAL');
 assert.equal(purchaseDocumentState([{type:'INV',fileId:'I',linked:true}]),'PROVISIONAL');
 assert.equal(purchaseDocumentState([{type:'INV',fileId:'I',linked:true}],true),'COMPLETE');
 assert.equal(purchaseDocumentState([{type:'INV',fileId:'I',linked:true,superseded:true}],true),'MISSING');
});
test('term date uses an actual invoice date, handles month boundary and refuses invalid dates',()=>{
 assert.equal(purchaseInvoiceDueDate('2026-01-31',30),'2026-03-02');assert.equal(purchaseInvoiceDueDate(null,30),null);assert.equal(purchaseInvoiceDueDate('2026-02-30',30),null);
});
test('shared History requires receipt, payment, Account verification and collected documents together',()=>{
 const all={warehouseClosed:true,paymentCompleted:true,accountVerified:true,documentsComplete:true};assert.equal(purchaseArchiveEligible(all),true);
 for(const key of Object.keys(all))assert.equal(purchaseArchiveEligible({...all,[key]:false}),false);
});
