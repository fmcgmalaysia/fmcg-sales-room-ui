const text=value=>String(value??'').trim();
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():'';
const validViews=new Set(['SUPPLIER_ACTIVE','SUPPLIER_COMPLETED','TRANSACTIONS','AUDIT_TRAIL']);
const limitOf=value=>Number.isSafeInteger(value)&&value>0?Math.min(value,100):50;
const cursorOf=item=>JSON.stringify([item._querySortAt,item._queryKey]);
const parseCursor=value=>{
  if(!value)return null;
  if(typeof value!=='string'||value.length>500)throw Error('Invalid Account query cursor.');
  let parsed;try{parsed=JSON.parse(value);}catch(_){throw Error('Invalid Account query cursor.');}
  if(!Array.isArray(parsed)||parsed.length!==2||parsed.some(item=>typeof item!=='string'))throw Error('Invalid Account query cursor.');
  return parsed;
};
const contains=(row,needle)=>!needle||[
  row.number,row.supplierName,row.customerName,
  ...(row.customers||[]).map(customer=>customer.name),
  ...(row.documents||[]).map(document=>document.number),
  ...(row.finance?.payments||[]).map(payment=>payment.reference)
].some(value=>text(value).toLowerCase().includes(needle));
const inRange=(value,from,to)=>{
  const stamp=date(value);if(!stamp)return !from&&!to;
  return (!from||stamp>=from)&&(!to||stamp<=to);
};
const isClosed=row=>row.supplierAccount?row.supplierAccount.closed===true:row.state==='HISTORY';
const supplierDate=row=>date(isClosed(row)?row.supplierAccount?.closure?.at||row.completedAt:row.updatedAt||row.createdAt);
const page=(items,input)=>{
  const cursor=parseCursor(input.cursor),limit=limitOf(input.limit);
  items.sort((a,b)=>String(b._querySortAt).localeCompare(String(a._querySortAt))||String(b._queryKey).localeCompare(String(a._queryKey)));
  const start=cursor?items.findIndex(item=>item._querySortAt===cursor[0]&&item._queryKey===cursor[1])+1:0;
  if(cursor&&start===0)throw Error('Account query cursor is no longer available. Refresh the list.');
  const selected=items.slice(start,start+limit),hasNext=start+limit<items.length;
  return {items:selected.map(({_querySortAt,_queryKey,...item})=>item),pageInfo:{limit,hasNext,nextCursor:hasNext?cursorOf(selected.at(-1)):null},total:items.length};
};
const supplierSummary=rows=>{
  const known=rows.every(row=>Number.isSafeInteger(row.finance?.payableCents));
  return {
    taskCount:rows.length,
    involvedSuppliers:new Set(rows.map(row=>row.supplierId).filter(Boolean)).size,
    totalAmountCents:known?rows.reduce((sum,row)=>sum+row.finance.payableCents,0):null,
    partiallyPaidCents:rows.filter(row=>Number.isSafeInteger(row.finance?.paidCents)&&row.finance.paidCents>0&&Number.isSafeInteger(row.finance?.balanceCents)&&row.finance.balanceCents>0).reduce((sum,row)=>sum+row.finance.paidCents,0)
  };
};

export function queryAccountReadModel(rows,input={}){
  if(!Array.isArray(rows)||!validViews.has(input.view))throw Error('Select an Account query view.');
  const needle=text(input.search).toLowerCase(),supplierId=text(input.supplierId),from=date(input.dateFrom),to=date(input.dateTo);
  if(input.dateFrom&&!from||input.dateTo&&!to||from&&to&&from>to)throw Error('Select a valid Account date range.');
  const scoped=rows.filter(row=>(!supplierId||row.supplierId===supplierId)&&contains(row,needle));
  const activeTotal=scoped.filter(row=>!isClosed(row)).length,completedTotal=scoped.filter(isClosed).length;
  const suppliers=[...new Map(scoped.filter(row=>row.supplierId).map(row=>[row.supplierId,{id:row.supplierId,name:row.supplierName}])).values()].sort((a,b)=>text(a.name).localeCompare(text(b.name)));
  if(input.view==='SUPPLIER_ACTIVE'||input.view==='SUPPLIER_COMPLETED'){
    const completed=input.view==='SUPPLIER_COMPLETED';
    const filtered=scoped.filter(row=>isClosed(row)===completed&&inRange(supplierDate(row),from,to));
    return {view:input.view,...page(filtered.map(row=>({...row,_querySortAt:supplierDate(row),_queryKey:text(row.id)})),input),summary:supplierSummary(filtered),counts:{active:activeTotal,completed:completedTotal},suppliers};
  }
  if(input.view==='TRANSACTIONS'){
    const items=scoped.flatMap(row=>(row.finance?.payments||[]).map((payment,index)=>({poId:row.id,poNumber:row.number,supplierId:row.supplierId,supplierName:row.supplierName,supplierBank:row.supplierBank||null,payment,_querySortAt:date(payment.at||payment.date),_queryKey:text(payment.id)||row.id+':'+index}))).filter(item=>inRange(item._querySortAt,from,to));
    return {view:input.view,...page(items,input),counts:{active:activeTotal,completed:completedTotal},suppliers};
  }
  const items=scoped.flatMap(row=>(row.history||[]).map((event,index)=>({poId:row.id,poNumber:row.number,supplierId:row.supplierId,supplierName:row.supplierName,event,_querySortAt:date(event.time),_queryKey:text(event.id)||row.id+':'+index}))).filter(item=>inRange(item._querySortAt,from,to));
  return {view:input.view,...page(items,input),counts:{active:activeTotal,completed:completedTotal},suppliers};
}
