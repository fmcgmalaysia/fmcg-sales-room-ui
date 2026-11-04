'use strict';
// Native diagnostic preparation ONLY. The owned wrapper is Permissions.Admin.
// Existing synthetic StockProtocolTest rows ONLY; no locks, writes or deletion.
async function measureNativeReadCapacity({items,input={},now=()=>Date.now()}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['samples','company'].includes(key))
  ||!Number.isSafeInteger(input.samples)||input.samples<1||input.samples>12||!['NCT','GHR'].includes(input.company)
  ||typeof items?.query!=='function'||typeof now!=='function')throw Error('Bounded read-only capacity request required');
 const started=now(),samples=[];let reads=0,seed;
 const query=()=>{reads++;return items.query('StockProtocolTest');};
 const timed=async(kind,read)=>{const before=now(),page=await read(),after=now();
  if(!Number.isFinite(after-before)||after<before||!Array.isArray(page?.items)||page.items.length>25||!Number.isSafeInteger(page.totalCount)||page.totalCount<page.items.length)throw Error('Native read sample unconfirmed');
  samples.push({kind,milliseconds:after-before,returnedRows:page.items.length,totalCount:page.totalCount});return page;};
 try{
  const page=await timed('EXISTING_SYNTHETIC_PAGE',()=>query().ascending('_id').limit(25).find({consistentRead:true,returnTotalCount:true}));
  if(page.items.some(row=>typeof row?._id!=='string'||!row._id))throw Error('Synthetic record identity unconfirmed');
  seed=page.items[0]?._id;
  for(let index=1;index<input.samples;index++){
   if(index%2===1&&seed)await timed('EXACT_EXISTING_SYNTHETIC',()=>query().eq('_id',seed).limit(2).find({consistentRead:true,returnTotalCount:true}));
   else await timed('COMPANY_SYNTHETIC_PAGE',()=>query().eq('company',input.company).ascending('_id').limit(25).find({consistentRead:true,returnTotalCount:true}));
  }
  const finished=now();if(!Number.isFinite(finished-started)||finished<started)throw Error('Native read clock unconfirmed');
  return{ok:true,schema:'STOCK_NATIVE_READ_SAMPLE_V1',readOnly:true,collection:'StockProtocolTest',company:input.company,
   readCalls:reads,elapsedMilliseconds:finished-started,existingSyntheticRecordFound:Boolean(seed),samples,
   productionCapacityAccepted:false,unmeasured:['Original300line preparation','Conditional domain writes','Stock collection indexes','Large history','File callbacks','Interrupted recovery']};
 }catch(_){return{ok:false,schema:'STOCK_NATIVE_READ_SAMPLE_V1',readOnly:true,collection:'StockProtocolTest',company:input.company,readCalls:reads,
  completedSamples:samples,error:'Read-only native sample unconfirmed. No records were created, changed or removed.',productionCapacityAccepted:false};}
}
// Separately invoked readonly SDK capability check. Existing <=25 isolated rows
// supply exact expected identities; requested missing IDs are proven absent from
// that COMPLETE seed. Never takes arbitrary IDs/collections from a browser.
async function measureNativeBatchRead({items,input={},now=()=>Date.now()}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='company')
  ||!['NCT','GHR'].includes(input.company)||typeof items?.query!=='function'||typeof now!=='function')throw Error('Bounded read-only batch request required');
 const started=now(),samples=[];let reads=0;
 const query=()=>{reads++;return items.query('StockProtocolTest');};
 const timed=async(kind,read)=>{const before=now(),page=await read(),after=now();
  if(!Array.isArray(page?.items)||!Number.isSafeInteger(page.totalCount)||page.totalCount<0
   ||page.totalCount!==page.items.length||page.items.length>50||!Number.isFinite(after-before)||after<before)throw Error('Complete native batch result required');
  samples.push({kind,milliseconds:after-before,returnedRows:page.items.length,totalCount:page.totalCount});return page.items;};
 try{
  const seed=await timed('COMPLETE_EXISTING_SYNTHETIC_SEED',()=>query().ascending('_id').limit(25).find({consistentRead:true,returnTotalCount:true}));
  if(seed.some(row=>typeof row?._id!=='string'||!row._id)||new Set(seed.map(row=>row._id)).size!==seed.length||seed.length>25)throw Error('Exact synthetic seed required');
  const expected=new Set(seed.map(row=>row._id)),ids=[...expected];let suffix=0;
  while(ids.length<50){const missing='STOCK_READ_ONLY_MISSING_'+suffix++;if(!expected.has(missing))ids.push(missing);}
  const check=(rows,filtered)=>{
   const expectedRows=seed.filter(row=>!filtered||row.company===input.company),found=new Set();
   if(rows.length!==expectedRows.length)throw Error('Native batch cardinality conflict');
   for(const row of rows){if(!expected.has(row?._id)||found.has(row._id)||filtered&&row.company!==input.company)throw Error('Native batch identity conflict');found.add(row._id);}
   if(expectedRows.some(row=>!found.has(row._id)))throw Error('Native batch exact result missing');
  };
  check(await timed('EXACT_ID_BATCH_50',()=>query().hasSome('_id',ids).limit(51).find({consistentRead:true,returnTotalCount:true})),false);
  check(await timed('COMPANY_AND_EXACT_ID_BATCH_50',()=>query().eq('company',input.company).hasSome('_id',ids).limit(51).find({consistentRead:true,returnTotalCount:true})),true);
  const elapsed=now()-started;if(!Number.isFinite(elapsed)||elapsed<0)throw Error('Native batch clock unconfirmed');
  return{ok:true,schema:'STOCK_NATIVE_BATCH_READ_V1',readOnly:true,collection:'StockProtocolTest',company:input.company,readCalls:reads,
   elapsedMilliseconds:elapsed,requestedDistinctIds:50,existingSeedRows:seed.length,samples,productionCapacityAccepted:false,
   unmeasured:['Stock collection compound indexes','Actual300line native preparation','Typed domain writes','Interrupted recovery']};
 }catch(_){return{ok:false,schema:'STOCK_NATIVE_BATCH_READ_V1',readOnly:true,collection:'StockProtocolTest',company:input.company,readCalls:reads,
  completedSamples:samples,error:'Read-only native batch check unconfirmed. No records were created, changed or removed.',productionCapacityAccepted:false};}
}
module.exports={measureNativeReadCapacity,measureNativeBatchRead};
