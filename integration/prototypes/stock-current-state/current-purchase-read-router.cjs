'use strict';
const { hash }=require('./commit-proof.cjs');
// Invoked only after original Purchase auth. Missing control never authorizes the
// old workspace's implicit GP cache writer. Browser metadata does not choose mode.
function createCurrentPurchaseReadRouter({company,readControl,readLegacy,readCurrent}) {
  if(!['NCT','GHR'].includes(company)||[readControl,readLegacy,readCurrent].some(fn=>typeof fn!=='function'))throw Error('Private Purchase read routing dependencies required');
  return async()=>{
    const control=await readControl();
    if(!control||control._id!==hash(company,'STOCK_CONTROL')||control.company!==company||control.schemaVersion!==1
      ||typeof control.stockCommitVersion!=='string'||!control.stockCommitVersion||!Number.isSafeInteger(control.generation)||control.generation<0
      ||!['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(control.mode))throw Error('Purchase stock read mode unconfirmed');
    if(control.pending!==null)throw Error('Purchase inventory save pending; retain original request');
    if(control.mode==='LEGACY')return readLegacy();
    if(control.mode!=='ACTIVE')throw Error('Purchase inventory maintenance is in progress');
    return readCurrent(company);
  };
}
module.exports={createCurrentPurchaseReadRouter};
