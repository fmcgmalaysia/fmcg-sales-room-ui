const assert = require('node:assert/strict');

const oldRead = "const company=state.company,generation=++state.generation;state.reading=true;\n   try{const result=await sender('PACKING_READ_REQUEST',company);if(company!==state.company||generation!==state.generation||busy())return;if(result.company!==company||result.deskDeliveryVersion!==2)throw Error('Desk task service is not ready.');state.lists=result.lists.filter(list=>list.desk);state.completedLists=(result.completedLists||[]).filter(list=>list.desk&&list.batchComplete);state.staff=result.staff?.staffName||'';state.loaded=true;state.notice='';}\n   catch(error){if(generation===state.generation)state.notice=error.message;}\n   finally{if(generation===state.generation){state.reading=false;if(!busy())render();}}";

const newRead = `const company=state.company,generation=++state.generation;state.reading=true;
   let changed=false;
   try{
    const result=await sender('PACKING_READ_REQUEST',company);
    if(company!==state.company||generation!==state.generation||busy())return;
    if(result.company!==company||result.deskDeliveryVersion!==2)throw Error('Desk task service is not ready.');
    const lists=result.lists.filter(list=>list.desk);
    const completed=(result.completedLists||[]).filter(list=>list.desk&&list.batchComplete);
    const staff=result.staff?.staffName||'';
    const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Kuala_Lumpur'});
    changed=manual||!state.loaded||Boolean(state.notice)||staff!==state.staff||day!==state.refreshDay||
      JSON.stringify([lists,completed])!==JSON.stringify([state.lists,state.completedLists]);
    if(changed){state.lists=lists;state.completedLists=completed;state.staff=staff;state.loaded=true;state.notice='';state.refreshDay=day;}
   }catch(error){
    if(generation===state.generation){changed=error.message!==state.notice;state.notice=error.message;}
   }finally{if(generation===state.generation){state.reading=false;if(changed&&!busy())render();}}`;

module.exports = function patchWarehouseRefresh(source) {
  assert.equal(source.split(oldRead).length, 2, 'Expected the exact published Warehouse refresh block');
  return source.replace(oldRead, newRead);
};
