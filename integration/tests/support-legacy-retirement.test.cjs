const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const p=require('../prototypes/support-desk-only-20261029/stage.cjs').plan();
test('only four unreferenced legacy resources leave the public package',()=>{assert.equal(p.assets.size,95);assert.deepEqual(p.references,[]);for(const file of p.retired)assert(!p.assets.has(file));assert.equal(p.retired.length,4);});
test('Desk and Packing retain their shared styles and active scripts byte-for-byte except version markers',()=>{
 for(const name of ['draft.css','draft-compact.css','workroom.css','workroom-model.js','packing-workbench.css','packing-model-browser.js','packing-transport.js'])assert.equal(p.assets.get('support-room/'+name).compare(p.baseline.get('support-room/'+name)),0,name);
 assert(p.assets.get('support-room/workroom.js').toString().includes('activeDesk'));
});
for(const file of p.redirects)test(file+' cannot render the retired no-Desk UI and preserves embedded company identity',()=>{
 const html=p.assets.get(file).toString();assert(!/Sales Invoicing|invoiceLines|draft-app.js|DESIGN DRAFT/.test(html));const source=html.match(/<script>([\s\S]+)<\/script>/)[1];
 for(const company of ['NCT','GHR']){let target='',link={};vm.runInNewContext(source,{URLSearchParams,location:{search:'?company='+company,replace:value=>target=value},parent:{},window:{},document:{getElementById:()=>link}});assert.equal(target,'workroom.html?live=1&department=SUPPORT&company='+company);assert.equal(link.href,target);}
 let topTarget='',same={};vm.runInNewContext(source,{URLSearchParams,location:{search:'',replace:value=>topTarget=value},parent:same,window:same,document:{getElementById:()=>({})}});assert.equal(topTarget,'https://fmcg999.wixstudio.com/master/support-department');
});
