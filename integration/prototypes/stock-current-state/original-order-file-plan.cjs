'use strict';
const {createHash}=require('node:crypto');
const {Buffer}=require('node:buffer');
const { hash } = require('./commit-proof.cjs'), { copy, same } = require('./segmented-plan.cjs');
const fileId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value);
const fieldsExcept = (value, fields) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !fields.includes(key)));
const noPayload = value => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { if (key === 'base64') throw Error('PDF payload cannot enter prepared order metadata'); noPayload(child); }
};
// Private ORIGINAL prepare capture only. Scratch journal, preallocated fixed slots,
// no legacy apply, external upload/trash, domain write, or change to file policy.
async function captureOriginalOrderFilePlan({ department, company, staff, requestId, input, context, records, rows, suppliers = [],
  createPurchaseOrderOperations, createAccountSettlementOperations, now, slots = [] }) {
  const purchase = department === 'PURCHASE', upload = input?.action === (purchase ? 'DOCUMENT' : 'DOCUMENT_UPLOAD');
  if (!['PURCHASE','ACCOUNT'].includes(department) || !['NCT','GHR'].includes(company) || !staff?.staffId || !staff.memberId || !staff.staffName
    || !/^[a-f0-9-]{36}$/i.test(requestId || '') || ![purchase ? 'DOCUMENT' : 'DOCUMENT_UPLOAD', purchase ? 'DELETE_DOCUMENT' : 'PAYMENT_FILE_DELETE'].includes(input?.action)
    || typeof now !== 'function' || !Array.isArray(records) || records.some(row => row.company !== company || !row._id || !row._version)
    || new Set(records.map(row => row._id)).size !== records.length || !Array.isArray(slots) || slots.some(id => !fileId(id)) || new Set(slots).size !== slots.length
    || slots.length !== (upload ? 1 + (!purchase && Array.isArray(input.attachments) ? input.attachments.length : 0) : 0)
    || purchase && (context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity) || typeof createPurchaseOrderOperations !== 'function')
    || !purchase && (!Array.isArray(rows) || rows.some(row => row.company !== company) || new Set(rows.map(row => row.id)).size !== rows.length || !Array.isArray(suppliers) || typeof createAccountSettlementOperations !== 'function')) {
    throw Error('Private original order file context required');
  }
  const before = records.find(row => row._id === input.id) || null, journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const expectedAuditId = hash(company,requestId,staff.memberId,purchase ? (upload ? 'PO_AUDIT' : 'PO_DELETE_AUDIT') : 'FINANCE');
  if ((before?.details?.audit || []).some(event => event.id === expectedAuditId)) throw Error('Preexisting original file audit without current receipt requires review');
  const scratch = new Map(), boundary = Error('Original order file prepare boundary'); let captured, reads = 0, allocated = 0;
  const store = {
    all: async collection => {
      if (purchase && collection === 'PurchaseOrders') return copy(records);
      if (!purchase && collection === 'SharedSuppliers') return copy(suppliers);
      throw Error('Original file preparation table scope');
    },
    read: async (collection, id) => {
      if (collection === journal) return copy(scratch.get(id) || null);
      if (collection !== 'PurchaseOrders' || id !== input.id) throw Error('Original file preparation record scope'); return copy(before);
    },
    insert: async (collection, row) => {
      if (collection === journal && row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan) throw Error('Original file preparation conflict'); captured = copy(row.details.plan); throw boundary;
      }
      if (collection !== journal || row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Original file legacy apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    },
    remove: async (collection, id) => { if (collection !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private scratch file lock removal allowed'); scratch.delete(id); }
  };
  const documentService = async command => {
    if (!upload || !same(command, { action:'ALLOCATE',company }) || allocated >= slots.length) throw Error('External order file action forbidden during preparation');
    return { ok:true,fileId:slots[allocated++] };
  };
  const readOriginal = async (selected, employee) => {
    if (selected !== company || employee.memberId !== staff.memberId || employee.staffId !== staff.staffId || ++reads !== 1) throw Error('Original file preparation actor/context changed');
    return copy(purchase ? context : rows);
  };
  const shared = { store, now, documentService, names:{ [company]:{ activity:journal } } };
  const operations = purchase ? createPurchaseOrderOperations({ ...shared,readWorkspace:readOriginal }) : createAccountSettlementOperations({ ...shared,listOrders:readOriginal });
  try { await operations.save({ company,staff:copy(staff),requestId,input:copy(input) }); throw Error('Original file prepare boundary missing'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size || allocated !== slots.length || captured.expectedVersion !== input.version) throw Error('Original file preparation incomplete');
  noPayload(captured);
  const audit = purchase ? captured.event : captured.audit, record = captured.record;
  const expectedAction = purchase ? (upload ? 'SUPPLIER_DOCUMENT_UPLOADED' : 'SUPPLIER_DOCUMENT_DELETED') : 'ACCOUNT_' + input.action;
  if (audit?.id !== expectedAuditId || audit.action !== expectedAction || audit.actorStaffId !== staff.staffId || audit.actor !== staff.staffName || audit.result !== 'SAVED'
    || (purchase || upload) && captured.expected !== (before ? hash(before) : null)) throw Error('Original file audit/record identity conflict');
  if (upload || !purchase) {
    const allowed = purchase ? ['documents','finalInvoiceComplete','documentIssues','taskIds','createdAt','createdBy','updatedAt','audit']
      : upload ? ['finance','documents','chasePayment','taskIds','createdAt','createdBy','updatedAt','audit'] : ['finance','updatedAt','audit'];
    if (!record || record._id !== input.id || record.title !== input.id || record.company !== company
      || before && !same(fieldsExcept(before,['details']),fieldsExcept(record,['details']))
      || !same(fieldsExcept(before?.details,allowed),fieldsExcept(record.details,allowed))
      || !same(record.details.audit.at(-1),audit) || !same(record.details.audit.slice(0,-1),before?.details?.audit || [])) throw Error('Original file cannot alter unrelated record or audit');
    if (!purchase && !same(fieldsExcept(before?.details?.finance,upload ? ['payments','check'] : ['payments']),fieldsExcept(record.details.finance,upload ? ['payments','check'] : ['payments']))) throw Error('Original file cannot alter unrelated finance');
  } else if (!before || !same(captured.document,before.details?.documents?.find(doc => doc.fileId === input.fileId)) || !same(captured.taskIds,before.details.taskIds)
    || typeof captured.startedAt !== 'string' || !Number.isFinite(Date.parse(captured.startedAt))) throw Error('Original pending deletion identity conflict');
  const uploads = upload ? [captured.upload,...(captured.extraUploads || [])] : [];
  if (uploads.length !== slots.length || Boolean(captured.trash) === upload) throw Error('Original file side-effect shape conflict');
  for (const [index, command] of uploads.entries()) {
    const pdf = index ? input.attachments[index-1]?.base64 : input.base64;
    const bytes = Buffer.from(pdf,'base64');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (command.action !== 'UPLOAD' || command.company !== company || command.poId !== input.id || command.fileId !== slots[index]
      || command.sha256 !== sha256 || command.type !== input.type || !command.name || (command.department || 'PURCHASE') !== (!purchase && input.type === 'PAYMENT' ? 'ACCOUNT' : 'PURCHASE')) throw Error('Original fixed upload slot conflict');
  }
  if (!upload && (captured.trash.action !== 'TRASH' || captured.trash.company !== company || captured.trash.poId !== input.id || captured.trash.fileId !== input.fileId
    || !captured.trash.sha256 || !captured.trash.name || !purchase && (captured.trash.department !== 'ACCOUNT' || captured.trash.type !== 'PAYMENT'))) throw Error('Original exact trash scope required');
  return { before:copy(before),prepared:captured,uploads:copy(uploads),trash:captured.trash ? copy(captured.trash) : null };
}
async function prepareOriginalOrderFileWrite(args) {
  const captured = await captureOriginalOrderFilePlan(args);
  if (args.department === 'PURCHASE' && args.input.action === 'DELETE_DOCUMENT') throw Error('Original Purchase deletion requires pending-unlink stage; not a single-write upload');
  const after = copy(captured.prepared.record);
  if (args.department === 'PURCHASE') for (const command of captured.uploads) {
    const document = after.details.documents.find(doc => doc.fileId === command.fileId);
    if (!document) throw Error('Original uploaded document missing'); document.url = 'https://drive.google.com/file/d/'+command.fileId+'/view';
  }
  return { writes:[{ collection:'PurchaseOrders',before:captured.before,after,
    orderFile:{ department:args.department,uploads:captured.uploads,trash:captured.trash } }] };
}
module.exports = { captureOriginalOrderFilePlan,prepareOriginalOrderFileWrite };
