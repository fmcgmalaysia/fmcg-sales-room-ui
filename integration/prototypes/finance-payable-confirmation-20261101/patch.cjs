const assert=require('node:assert/strict');
function recordedInvoice(row){
 const invoices=(row.documents||[]).filter(d=>d.type==='INV'&&d.linked===true&&!d.superseded&&d.fileId&&d.sha256);
 const known=invoices.length>0&&invoices.every(d=>Number.isSafeInteger(d.declaredCents)&&d.declaredCents>0);
 const total=known?invoices.reduce((sum,d)=>sum+d.declaredCents,0):null;
 return {total:Number.isSafeInteger(total)?total:null,label:!invoices.length?'Awaiting invoice':known?'Invoice total · unconfirmed':'Invoice amount not recorded',confirmable:invoices.length>0};
}
function patch(source){
 const once=(from,to)=>{assert.equal(source.split(from).length,2,from.slice(0,80));source=source.replace(from,()=>to);};
 once(' const amounts=row=>',recordedInvoice.toString()+'\n const amounts=row=>');
 once("money(view==='payments'?a.balance:a.requested)","money(supplierView&&a.requested==null?recordedInvoice(row).total:view==='payments'?a.balance:a.requested)");
 once("(supplierView?(Number.isSafeInteger(a.requested)?'Payable':'Payable pending review'):view==='payments'?'Request balance':'Requested')","(supplierView?(a.requested==null?recordedInvoice(row).label:'Payable'):view==='payments'?'Request balance':'Requested')");
 once("+(supplierView&&inPaymentPlan(row)?", "+(supplierView&&a.requested==null&&recordedInvoice(row).confirmable&&!isClosed(row)?'<button type=\"button\" class=\"btn\" data-settlement=\"amounts\" data-po=\"'+esc(row.id)+'\">Confirm INV/CN amounts</button>':'')+(supplierView&&inPaymentPlan(row)?");
 once("'<small>Balance '+money(a.balance)+'</small>'","'<small>'+(supplierView&&a.requested==null?'Final balance pending confirmation':'Balance '+money(a.balance))+'</small>'");
 once("data-status=\"Awaiting Invoice\">Awaiting Invoice</span>","data-status=\"Awaiting Invoice\">'+(recordedInvoice(row).confirmable?'Awaiting confirmation':'Awaiting Invoice')+'</span>");
 return source;
}
module.exports={patch,recordedInvoice};
