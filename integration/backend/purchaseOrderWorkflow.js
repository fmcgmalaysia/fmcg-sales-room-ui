import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import { purchaseDocumentName, purchaseDocumentState, purchaseInvoiceDueDate } from 'backend/purchaseDocumentPolicy.js';
export const PURCHASE_ORDER_COLLECTION = 'PurchaseOrders';
const text = value => String(value ?? '').trim();
const finite = value => typeof value === 'number' && Number.isFinite(value);
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const groupKey = row => JSON.stringify([row.customerId,row.supplierId,row.po]);

// A stored identity survives number changes. Tasks and supplier plans remain authoritative.
export function projectPurchaseOrders({company,workspace,records,now=new Date()}) {
  if(!['NCT','GHR'].includes(company)||workspace.company!==company)throw Error('Select NCT or GHR.');
  const groups=new Map(),used=new Set();
  for(const row of workspace.tasks.filter(row=>text(row.po))) {
    const key=groupKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  return [...groups.values()].map(rows=>{
    const taskIds=rows.map(row=>row.id).sort(),first=rows[0];
    const matches=records.filter(record=>record.company===company&&record.details?.taskIds?.some(id=>taskIds.includes(id)));
    if(matches.length>1)throw Error('These tasks belong to different saved purchase orders. Review their P.O. association.');
    const record=matches[0],details=record?.details||{};
    if(record&&(used.has(record._id)||details.taskIds.some(id=>!taskIds.includes(id))))throw Error('A saved purchase order was split. Restore its task association before editing it.');
    if(record)used.add(record._id);
    const events=new Map();for(const row of rows)for(const event of row.history||[])if(event.result==='SAVED'&&event.action.startsWith('PURCHASE_'))events.set(event.id,event);
    const history=[...events.values()].sort((a,b)=>String(a.time).localeCompare(String(b.time)));
    const assigned=history.find(event=>event.action==='PURCHASE_PO_ASSIGNED');
    const id=record?._id||operationId(company,'PURCHASE_ORDER',taskIds);
    const supplier=workspace.suppliers.find(item=>item.id===first.supplierId),customer=workspace.customers.find(item=>item.id===first.customerId);
    const complete=rows.every(row=>Number.isSafeInteger(row.procurement?.totalCtn)&&row.procurement.totalCtn>0&&['lpCtn','disc1','disc2','disc3'].every(key=>finite(row[key]))&&row.lpCtn*(1-row.disc1)*(1-row.disc2)-row.disc3>=0);
    const amount=complete?rows.reduce((sum,row)=>sum+Math.round((row.lpCtn*(1-row.disc1)*(1-row.disc2)-row.disc3)*row.procurement.totalCtn*100),0)/100:null;
    const documents=(details.documents||[]).filter(doc=>doc.linked===true),invoiceDates=documents.filter(doc=>doc.type==='INV'&&!doc.superseded).map(doc=>doc.date).sort();
    const invoiceDate=invoiceDates[0]||null,termDays=Number.isSafeInteger(details.termDays)?details.termDays:null;
    // Invoice dates, receipt closure and payment completion are not inferred from tasks.
    // Their department writers are not connected yet; never offer a premature archive.
    return {id,version:operationId(record||null,taskIds,rows.map(row=>row.editVersion)),taskIds,
      number:first.po,company,currency:'MYR',customerId:first.customerId,customerName:customer?.shortName||customer?.name||'',
      supplierId:first.supplierId,supplierShortName:supplier?.shortName||supplier?.name||'',supplierName:supplier?.name||'',
      createdAt:details.createdAt||date(assigned?.time),createdBy:details.createdBy||text(assigned?.actor),
      itemCount:new Set(rows.map(row=>JSON.stringify([row.barcode,row.packing]))).size,amount,
      termDays,invoiceDate,dueDate:purchaseInvoiceDueDate(invoiceDate,termDays),
      chasePayment:details.chasePayment===true,state:'ACTIVE',documents,documentStatus:purchaseDocumentState(documents,details.finalInvoiceComplete===true),
      status:'Awaiting payment records',canArchive:false,archiveBlockers:['Warehouse receipt closure','Completed supplier payment','Final Account verification'],
      history:[...history,...(details.audit||[])].sort((a,b)=>String(a.time).localeCompare(String(b.time))),
      updatedAt:date(details.updatedAt),readAt:now.toISOString()};
  }).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||a.number.localeCompare(b.number));
}

export function createPurchaseOrderOperations({store,readWorkspace,names,documentService,now=()=>new Date()}) {
  const journal=createOperationJournal({store,now});
  async function list(company,staff){
    if(!names[company])throw Error('Select NCT or GHR.');
    const [workspace,records]=await Promise.all([readWorkspace(company,staff),store.all(PURCHASE_ORDER_COLLECTION)]);
    return projectPurchaseOrders({company,workspace,records,now:now()});
  }
  async function save({company,staff,requestId,input}) {
    if(!names[company]||!input||!['CHASE','TERM','DOCUMENT'].includes(input.action))throw Error('Unsupported purchase order action.');
    let payload=null,journalInput=input;
    if(input.action==='DOCUMENT'){
      if(!documentService)throw Error('Document upload is not connected.');
      if(typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Select a PDF up to 3 MiB.');
      const bytes=Buffer.from(input.base64,'base64');
      if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64)throw Error('Select a valid PDF up to 3 MiB.');
      payload=input.base64;
      journalInput={id:input.id,version:input.version,action:'DOCUMENT',type:input.type,date:input.date,number:text(input.number),reason:text(input.reason),sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
    }
    return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{purchaseOrder:journalInput},prepare:async()=>{
      const rows=await list(company,staff),row=rows.find(row=>row.id===input.id);
      if(!row||row.version!==input.version)throw Error('Purchase order changed. Refresh before saving; your input is retained.');
      const current=await store.read(PURCHASE_ORDER_COLLECTION,row.id),before=current?.details||{};
      const reason=text(input.reason);if(!reason||reason.length>2000)throw Error('Please enter a reason.');
      let patch;
      let upload;
      if(input.action==='DOCUMENT'){
        if(!row.supplierId)throw Error('Select a supplier before uploading documents.');
        const name=purchaseDocumentName({date:input.date,supplierShortName:row.supplierShortName,type:input.type,number:input.number});
        if((before.documents||[]).some(doc=>doc.linked&&doc.sha256===journalInput.sha256&&doc.type===input.type&&doc.number===text(input.number)))throw Error('This document is already linked to the purchase order.');
        const allocated=await documentService({action:'ALLOCATE',company});
        upload={action:'UPLOAD',company,poId:row.id,fileId:allocated.fileId,name,type:input.type,sha256:journalInput.sha256};
        const document={fileId:allocated.fileId,name,type:input.type,number:text(input.number),date:input.date,size:journalInput.size,sha256:journalInput.sha256,linked:true,uploadedAt:now().toISOString(),uploadedBy:staff.staffName,uploadedByStaffId:staff.staffId};
        patch={documents:[...(before.documents||[]),document],...(input.type==='INV'?{finalInvoiceComplete:true}:{})};
      } else if(input.action==='CHASE'){
        if(typeof input.enabled!=='boolean'||input.enabled===row.chasePayment)throw Error('Payment chase has not changed.');
        patch={chasePayment:input.enabled};
      } else {
        if(!Number.isSafeInteger(input.termDays)||input.termDays<0||input.termDays>3650)throw Error('Enter payment terms from 0 to 3650 days.');
        if(input.termDays===row.termDays)throw Error('Payment term has not changed.');
        patch={termDays:input.termDays};
      }
      const at=now().toISOString(),event={id:operationId(company,requestId,staff.memberId,'PO_AUDIT'),action:input.action==='DOCUMENT'?'SUPPLIER_DOCUMENT_UPLOADED':input.action==='CHASE'?'PAYMENT_CHASE_CHANGED':'PAYMENT_TERM_CHANGED',time:at,actor:staff.staffName,actorStaffId:staff.staffId,result:'SAVED',message:reason,changes:input.action==='DOCUMENT'?{type:input.type,number:text(input.number),date:input.date,fileId:upload.fileId,reason}:{before:Object.fromEntries(Object.keys(patch).map(key=>[key,row[key]])),after:patch,reason}};
      const record={...(current||{}),_id:row.id,title:row.id,company,details:{...before,taskIds:row.taskIds,createdAt:row.createdAt,createdBy:row.createdBy,...patch,updatedAt:at,audit:[...(before.audit||[]),event]}};
      return {record,expected:current?operationId(current):null,event,...(upload?{upload}:{})};
    },apply:async plan=>{
      const current=await store.read(PURCHASE_ORDER_COLLECTION,plan.record._id);
      if(!current?.details?.audit?.some(event=>event.id===plan.event.id)) {
        if((current?operationId(current):null)!==plan.expected)throw Error('Purchase order changed while saving.');
        if(plan.upload){
          const receipt=await documentService({...plan.upload,base64:payload});
          if(receipt.ok!==true||receipt.fileId!==plan.upload.fileId||receipt.sha256!==plan.upload.sha256||receipt.company!==company||receipt.poId!==plan.record._id||receipt.name!==plan.upload.name)throw Error('Document upload receipt mismatch.');
          // Persist association only after Drive confirms the exact preallocated file.
          const document=plan.record.details.documents.find(doc=>doc.fileId===receipt.fileId);
          document.url='https://drive.google.com/file/d/'+receipt.fileId+'/view';
        }
        if(current)await store.update(PURCHASE_ORDER_COLLECTION,plan.record);else await store.insert(PURCHASE_ORDER_COLLECTION,plan.record);
      }
      return {ok:true,company,requestId,poId:plan.record._id,savedAt:plan.event.time};
    }});
  }
  return {list,save};
}
