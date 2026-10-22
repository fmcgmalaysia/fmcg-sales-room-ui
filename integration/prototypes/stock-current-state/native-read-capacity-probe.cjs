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
module.exports={measureNativeReadCapacity};
