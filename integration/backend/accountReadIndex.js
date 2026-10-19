import { createHash } from 'crypto';

export const ACCOUNT_READ_INDEX_COLLECTION='AccountReadIndex';
export const ACCOUNT_READ_INDEX_SCHEMA_VERSION=1;
const kinds=new Set(['CASE','TRANSACTION','AUDIT']);
const text=value=>String(value??'').trim();
const iso=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():'';
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>!['_createdDate','_updatedDate','_owner'].includes(key)).map(key=>[key,canonical(value[key])]));
  return value;
};
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const recordId=(company,generation,kind,sourceId)=>digest(['ACCOUNT_READ_INDEX',company,generation,kind,sourceId]).slice(0,32);
const closed=row=>row.supplierAccount?row.supplierAccount.closed===true:row.state==='HISTORY';
const caseDate=row=>iso(closed(row)?row.supplierAccount?.closure?.at||row.completedAt:row.updatedAt||row.createdAt);
const casePayload=row=>{
  const payload=clone(row),history=Array.isArray(payload.history)?payload.history:[];
  delete payload.history;
  delete payload.canDeletePaymentFiles;
  return {payload,history};
};
const searchable=(...values)=>values.flat(Infinity).map(text).filter(Boolean).join(' ').toLowerCase();
const safeSourceId=(value,fallback)=>text(value)||digest(fallback).slice(0,24);
const rowBase=({company,generation,kind,sourceId,row,sortAt,searchText})=>({
  _id:recordId(company,generation,kind,sourceId),
  title:`${kind} ${row.number||row.id||sourceId}`,
  company,generation,kind,sourceId,
  poId:text(row.id),poNumber:text(row.number),supplierId:text(row.supplierId),supplierName:text(row.supplierName),
  customerName:text(row.customerName),sortAt:sortAt||'1970-01-01T00:00:00.000Z',searchText,
  schemaVersion:ACCOUNT_READ_INDEX_SCHEMA_VERSION
});

export function buildAccountReadIndex({company,rows}){
  if(!text(company)||!Array.isArray(rows))throw Error('Account read index requires a company and projected rows.');
  const prepared=clone(rows).sort((a,b)=>text(a.id).localeCompare(text(b.id))).map(row=>{
    const {payload,history}=casePayload(row);
    return {row,payload,history};
  });
  const generation=digest({schemaVersion:ACCOUNT_READ_INDEX_SCHEMA_VERSION,company:text(company),rows:prepared.map(({payload,history})=>({payload,history}))}).slice(0,32);
  const records=[];
  for(const {row,payload,history} of prepared){
    const commonSearch=[row.number,row.supplierName,row.customerName,(row.customers||[]).map(item=>item.name),(row.documents||[]).map(item=>item.number)];
    const sourceId=text(row.id);
    if(!sourceId)throw Error('Account read index cannot include a case without an id.');
    records.push({...rowBase({company:text(company),generation,kind:'CASE',sourceId,row,sortAt:caseDate(row),searchText:searchable(commonSearch)}),status:closed(row)?'COMPLETED':'ACTIVE',payableCents:Number.isSafeInteger(row.finance?.payableCents)?row.finance.payableCents:null,paidCents:Number.isSafeInteger(row.finance?.paidCents)?row.finance.paidCents:null,balanceCents:Number.isSafeInteger(row.finance?.balanceCents)?row.finance.balanceCents:null,partiallyPaidCents:Number.isSafeInteger(row.finance?.paidCents)&&row.finance.paidCents>0&&Number.isSafeInteger(row.finance?.balanceCents)&&row.finance.balanceCents>0?row.finance.paidCents:0,payload});
    (row.finance?.payments||[]).forEach((payment,index)=>{
      const paymentId=safeSourceId(payment.id,[sourceId,'PAYMENT',index,payment]);
      records.push({...rowBase({company:text(company),generation,kind:'TRANSACTION',sourceId:`${sourceId}:${paymentId}`,row,sortAt:iso(payment.at||payment.date),searchText:searchable(commonSearch,paymentId,payment.reference,payment.by,payment.paymentSource)}),paymentId,payload:{payment:clone(payment),row:payload}});
    });
    history.forEach((event,index)=>{
      const eventId=safeSourceId(event.id,[sourceId,'AUDIT',index,event]);
      records.push({...rowBase({company:text(company),generation,kind:'AUDIT',sourceId:`${sourceId}:${eventId}`,row,sortAt:iso(event.time),searchText:searchable(commonSearch,eventId,event.action,event.actor,event.message)}),eventId,payload:{event:clone(event)}});
    });
  }
  records.sort((a,b)=>a.kind.localeCompare(b.kind)||a.sourceId.localeCompare(b.sourceId));
  return {company:text(company),generation,schemaVersion:ACCOUNT_READ_INDEX_SCHEMA_VERSION,records,counts:{cases:records.filter(row=>row.kind==='CASE').length,transactions:records.filter(row=>row.kind==='TRANSACTION').length,audits:records.filter(row=>row.kind==='AUDIT').length},contentHash:digest(records)};
}

const comparable=record=>canonical(Object.fromEntries(Object.entries(record||{}).filter(([key])=>!['_createdDate','_updatedDate','_owner'].includes(key))));
export function compareAccountReadIndex(expected,actualRecords){
  if(!expected?.generation||!Array.isArray(expected.records)||!Array.isArray(actualRecords))throw Error('Account read index comparison requires a plan and stored records.');
  const expectedById=new Map(expected.records.map(record=>[record._id,record])),actualById=new Map(actualRecords.filter(record=>record.generation===expected.generation&&kinds.has(record.kind)).map(record=>[record._id,record]));
  const missing=[...expectedById.keys()].filter(id=>!actualById.has(id));
  const extra=[...actualById.keys()].filter(id=>!expectedById.has(id));
  const changed=[...expectedById.keys()].filter(id=>actualById.has(id)&&digest(comparable(expectedById.get(id)))!==digest(comparable(actualById.get(id))));
  return {ok:missing.length===0&&extra.length===0&&changed.length===0,generation:expected.generation,expected:expected.records.length,actual:actualById.size,missing,extra,changed};
}
