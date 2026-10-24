const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve)),digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const meta={schema:'CURRENT_STOCK_V2',stockProtocol:1,stockBuild:'TEST',stockGeneration:3,stockIdentity:{staffId:'S',memberId:'SOURCE_SALES/S'}};
function fixture(db=new Map()){
 const nodes=new Map(),sent=[],events=[],gets=[],listeners=new Set(),timers=new Map();let ids=0,html='',closed=0,failWrite=false,failRemove=false;
 const dialog={open:false,className:'',showModal(){this.open=true;},close(){this.open=false;closed++;},addEventListener(){},
  querySelector:selector=>nodes.get(selector),querySelectorAll:selector=>selector==='input,select,textarea,[data-upload]'?[...nodes].filter(([key])=>!['[data-close]','[data-retry]','[data-status]','[data-purpose]','[data-invoice-row]'].includes(key)).map(([,value])=>value):[...nodes.values()],
  set innerHTML(value){html=value;nodes.clear();for(const match of value.matchAll(/data-([a-z-]+)(?:="([^"]*)")?/g)){const key='[data-'+match[1]+']';if(!nodes.has(key))nodes.set(key,{value:match[1]==='type'?'SALES_INV':'',files:[],disabled:false,hidden:false,readOnly:false,textContent:''});}},get innerHTML(){return html;}};
 const parent={postMessage:request=>{events.push(request.action==='DOCUMENT'?'SAVE':'READ');sent.push(copy(request));}},window={parent,addEventListener:(kind,handler)=>{if(kind==='message')listeners.add(handler);}};
 const context={window,parent,document:{createElement:()=>dialog,body:{appendChild(){}}},crypto:{randomUUID:()=>String(++ids).padStart(8,'0')+'-1111-4111-8111-111111111111'},
  sessionStorage:{getItem:key=>{gets.push(key);return db.get(key)||null;},setItem:(key,value)=>{if(failWrite)throw Error('Cache unavailable');events.push('CACHE');db.set(key,value);},removeItem:key=>{if(!failRemove)db.delete(key);}},
  setTimeout:(fn,ms)=>{const id=++ids;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),TextDecoder,btoa:binary=>Buffer.from(binary,'binary').toString('base64')};
 for(const name of ['source-sales-current-requests.js','customer-documents.candidate.js'])vm.runInNewContext(fs.readFileSync(path.join(folder,name),'utf8'),context);
 function reply(result,extra={},source=parent){const request=sent.at(-1);for(const handler of [...listeners])handler({source,data:{type:'SALES_ROOM_SHIPMENT_RESULT',company:request.company,requestId:request.requestId,ok:true,result,...extra}});}
 const read=current=>({company:'NCT',accountVersion:'ACCOUNT',customers:[{id:'C',name:'Customer'}],customerAccount:{entries:[]},shipments:[],...(current?{stockCurrent:current}:{})});
 function selectFile(bytes=Buffer.from('%PDF-1.4\nOriginal')){nodes.get('[data-file]').files=[{name:'Original.pdf',type:'application/pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}];}
 async function upload(){nodes.get('[data-type]').value='CUSTOMER_RECEIPT';nodes.get('[data-type]').onchange();for(const[key,value]of Object.entries({number:'RCV-1',date:'2026-10-22',currency:'USD',amount:'100.00',reason:'Original file'}))nodes.get('[data-'+key+']').value=value;await nodes.get('[data-upload]').onclick();}
 async function start(current=meta,bytes){window.customerSalesDocuments.open('C');reply(read(current));selectFile(bytes);await upload();}
 return{window,parent,nodes,dialog,sent,events,db,gets,timers,reply,read,selectFile,upload,start,retry:()=>nodes.get('[data-retry]').onclick(),closed:()=>closed,failWrite:()=>failWrite=true,failRemove:()=>failRemove=true,allowRemove:()=>failRemove=false};
}
function resume(f,customerId='C',staffId='S'){assert.deepEqual(f.sent.at(-1).input,{resume:'SOURCE_SALES_V1'});f.reply({ok:true,schema:'SOURCE_SALES_RESUME_V1',company:'NCT',customerId,staff:{staffId,memberId:'SOURCE_SALES/'+staffId}});}
const receipt=request=>({ok:true,company:'NCT',requestId:request.requestId,documentId:'ORIGINAL_DOCUMENT',stockGeneration:4});
test('actual original file UI preserves fields/layout and has reproducible minimal overlay; complete current PDF/view retained before save',async()=>{
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-source-document-ui.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 const original=fs.readFileSync(path.join(__dirname,'../../sales-room/customer-documents.js'),'utf8').replace(/\r\n/g,'\n'),candidate=fs.readFileSync(path.join(folder,'customer-documents.candidate.js'),'utf8');
 assert.equal(candidate,require(path.join(folder,'source-sales-document-ui-overlay.cjs'))(original));assert.equal(candidate.split('function render(){')[1].split('\nasync function upload()')[0],original.split('function render(){')[1].split('\nasync function upload()')[0]);
 const f=fixture();await f.start();assert.deepEqual(f.events,['READ','CACHE','SAVE']);const request=f.sent.at(-1),entry=JSON.parse([...f.db.values()][0]);assert.deepEqual(entry.request,request);assert.equal(entry.ui.kind,'DOCUMENT');assert.equal(entry.ui.file.name,'Original.pdf');assert.deepEqual(request.input.stockCurrent,meta);
 for(const phase of ['BEFORE','APPLY','VERIFY']){f.reply({ok:false,pending:true,requestId:request.requestId,phase,completedCount:1,totalRecords:2});const next=[...f.timers.entries()].find(([,timer])=>timer.ms===250);assert.ok(next);f.timers.delete(next[0]);next[1].fn();assert.equal(digest(f.sent.at(-1)),digest(request));}
 f.reply(receipt(request));assert.equal(f.db.size,0);assert.equal(f.sent.at(-1).action,'READ');
});
test('original maximum3MiB PDF remains retainable above ordinary200K cap; oversized/invalid PDF or unavailable cache never sends document',async()=>{
 const bytes=Buffer.alloc(3*1024*1024,97);bytes.write('%PDF-');const f=fixture();await f.start(meta,bytes);const request=f.sent.at(-1);assert.equal(request.action,'DOCUMENT');assert.ok(request.input.base64.length>200000);assert.equal(request.input.base64.length,4194304);assert.equal(f.db.size,1);
 for(const mode of ['quota','oversize','invalid']){const bad=fixture();if(mode==='quota')bad.failWrite();await bad.start(meta,mode==='oversize'?Buffer.alloc(3*1024*1024+1):mode==='invalid'?Buffer.from('NOT PDF'):undefined);assert.equal(bad.sent.some(row=>row.action==='DOCUMENT'),false);assert.equal(bad.db.size,0);}
});
test('unknown/error/wrong final or failed cache cleanup retains exact original PDF and locks fields/close, never falling into old reset regex',async()=>{
 const f=fixture();await f.start();const request=copy(f.sent.at(-1));
 for(const result of [{},{...receipt(request),company:'GHR'},{...receipt(request),documentId:''},{...receipt(request),stockGeneration:3}]){f.reply(result);assert.equal(f.db.size,1);assert.equal(f.nodes.get('[data-file]').disabled,true);assert.equal(f.nodes.get('[data-close]').disabled,true);f.retry();assert.equal(digest(f.sent.at(-1)),digest(request));}
 f.reply(null,{ok:false,error:'Customer ledger changed. Select a valid PDF'});f.retry();assert.equal(digest(f.sent.at(-1)),digest(request));
 f.failRemove();f.reply(receipt(request));assert.equal(f.db.size,1);assert.equal(f.sent.at(-1).action,'DOCUMENT');f.allowRemove();f.retry();f.reply(receipt(request));assert.equal(f.db.size,0);assert.equal(f.sent.at(-1).action,'READ');
});
test('reload freshly reauthorizes original customer and restores original read-only form without fabricating a selected file or autosending',async()=>{
 const first=fixture();await first.start();const request=copy(first.sent.at(-1)),f=fixture(first.db);f.window.customerSalesDocuments.open('OTHER');f.reply(f.read(meta));assert.equal(f.sent.at(-1).customerId,'C');resume(f);await tick();
 assert.equal(f.sent.some(row=>row.action==='DOCUMENT'),false);assert.equal(f.nodes.get('[data-file]').files.length,0);assert.match(f.nodes.get('[data-status]').textContent,/Original.pdf/);assert.equal(f.nodes.get('[data-type]').value,'CUSTOMER_RECEIPT');assert.equal(f.nodes.get('[data-number]').value,'RCV-1');assert.equal(f.nodes.get('[data-amount]').value,'100.00');assert.equal(f.nodes.get('[data-file]').disabled,true);
 f.retry();assert.equal(digest(f.sent.at(-1)),digest(request));assert.equal(f.db.size,1);
});
test('pending current READ recovers only own file cache through original auth-only path; foreign staff cannot read its key',async()=>{
 const first=fixture();await first.start();const request=copy(first.sent.at(-1)),f=fixture(first.db);f.window.customerSalesDocuments.open('C');f.reply(null,{ok:false,error:'Inventory pending'});assert.equal(f.gets.length,0);resume(f);await tick();resume(f);await tick();f.retry();assert.equal(digest(f.sent.at(-1)),digest(request));
 const other=fixture(first.db);other.window.customerSalesDocuments.open('C');other.reply(null,{ok:false,error:'Inventory pending'});resume(other,'C','OTHER');await tick();assert.equal(other.gets.some(key=>key.includes('/S/')),false);assert.equal(other.sent.some(row=>row.action==='DOCUMENT'),false);assert.equal(other.db.size,1);
});
test('timed-out and queued old attempts cannot unlock later phase, double-submit in flight, or send post-commit READ again',async()=>{
 const f=fixture();await f.start();const request=f.sent.at(-1),old=[...f.timers.values()].find(timer=>timer.ms===30000).fn;const count=f.sent.length;f.retry();assert.equal(f.sent.length,count);
 f.reply({ok:false,pending:true,requestId:request.requestId,phase:'APPLY',completedCount:1,totalRecords:2});old();assert.equal(f.nodes.get('[data-file]').disabled,true);const phase=[...f.timers.values()].find(timer=>timer.ms===250).fn;
 f.reply(receipt(request));const final=f.sent.length;phase();assert.equal(f.sent.length,final);assert.equal(f.sent.at(-1).action,'READ');
});
test('ordinary legacy upload and original validation error reset behavior stay original, without current cache',async()=>{
 const f=fixture();await f.start(null);assert.equal(f.sent.at(-1).input.stockCurrent,undefined);assert.equal(f.db.size,0);f.reply({ok:true,documentId:'LEGACY'});assert.equal(f.sent.at(-1).action,'READ');
 const g=fixture();await g.start(null);g.reply(null,{ok:false,error:'Customer ledger changed'});assert.equal(g.nodes.get('[data-close]').disabled,false);assert.equal(g.nodes.get('[data-file]').disabled,false);
});
test('same company cache from another Sales widget routes to original owner instead of allowing new document upload',async()=>{
 const f=fixture(),request={type:'SALES_ROOM_SHIPMENT_REQUEST',company:'NCT',customerId:'C',requestId:'11111111-1111-4111-8111-111111111111',action:'ADJUST',input:{orderId:'O',taskId:'T',mode:'SPLIT',quantity:4,version:'ADJ',stockCurrent:meta}};
 f.window.sourceSalesCurrent.retain(request,{kind:'ADJUST',selection:{company:'NCT',customerId:'C',orderId:'O',lineId:'L',quantity:10},data:{line:{taskId:'T',requested:10},quantity:10,version:'ADJ',stockCurrent:meta},mode:'SPLIT'});let restored;f.window.sourceSalesCurrent.register('ADJUST',entry=>restored=copy(entry));
 f.window.customerSalesDocuments.open('C');f.reply(f.read(meta));resume(f);await tick();assert.deepEqual(restored.request,request);assert.equal(f.closed(),1);assert.equal(f.sent.some(row=>row.action==='DOCUMENT'),false);assert.equal(f.db.size,1);
});
test('actual document UI and original one-argument bearer root compose through bounded file save and lost final reply without another file or ledger event',async()=>{
 const filename=path.join(__dirname,'stock-current-source-sales-root.test.cjs'),originalFixture=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',{require:createRequire(filename),__dirname:path.dirname(filename),Buffer,Map,Date});
 const root=await originalFixture(),ui=fixture(),dispatch=async request=>root.send({company:request.company,customerId:request.customerId,customerName:'Customer',staff:{staffId:'S',staffName:'Sales'},action:request.action,requestId:request.requestId,input:request.input});
 // Synthetic original Source staff authority supplied on server side only. This
 // is actual imported root/UI composition, NOT real Source auth/native/Drive QA.
 ui.window.customerSalesDocuments.open('C');const initial=await dispatch(ui.sent.at(-1));assert.equal(initial.status,200,initial.body.error);ui.reply(initial.body.result);ui.selectFile();await ui.upload();const request=copy(ui.sent.at(-1));
 let committed;for(let step=0;step<8;step++){const result=await dispatch(ui.sent.at(-1));assert.equal(result.status,200,result.body.error);
  if(result.body.result.ok){committed=result.body.result;break;}
  ui.reply(result.body.result);const continuation=[...ui.timers.entries()].find(([,timer])=>timer.ms===250);assert.ok(continuation);ui.timers.delete(continuation[0]);continuation[1].fn();assert.equal(digest(ui.sent.at(-1)),digest(request));
 }
 assert.ok(committed);assert.equal(root.files.size,1);ui.reply(null,{ok:false,error:'Final parent reply lost'});assert.equal(ui.db.size,1);ui.retry();assert.equal(digest(ui.sent.at(-1)),digest(request));
 const replay=await dispatch(ui.sent.at(-1));assert.equal(replay.status,200);assert.deepEqual(copy(replay.body.result),copy(committed));ui.reply(replay.body.result);
 assert.equal(ui.db.size,0);assert.equal(ui.sent.at(-1).action,'READ');assert.equal(root.fileCalls.filter(command=>command.action==='ALLOCATE').length,1);assert.equal(root.fileCalls.filter(command=>command.action==='UPLOAD').length,1);assert.equal([...root.db.values()].filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED').length,1);assert.equal([...root.db.values()].some(row=>row.details?.shipment?.status==='INVOICED'),false);
});
