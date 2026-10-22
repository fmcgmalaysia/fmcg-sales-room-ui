'use strict';
const { hash }=require('./commit-proof.cjs');
// Called only AFTER original Warehouse authentication. Browser cannot select mode.
function createCurrentWarehouseReceiptRouter({company,readControl,saveCurrent,saveLegacy}){
  if(!['NCT','GHR'].includes(company)||[readControl,saveCurrent,saveLegacy].some(fn=>typeof fn!=='function'))throw Error('Original Warehouse receipt routing dependencies required');
  return async request=>{
    const control=await readControl();
    if(control?._id!==hash(company,'STOCK_CONTROL')||control.company!==company||typeof control.stockCommitVersion!=='string'
      ||!control.stockCommitVersion||control.schemaVersion!==1||!Number.isSafeInteger(control.generation)||control.generation<0
      ||!['LEGACY','SHADOW','MAINTENANCE','ACTIVE'].includes(control.mode))throw Error('Warehouse inventory control unconfirmed. Retain the original receipt.');
    if(control.mode==='LEGACY'){
      if(control.pending!==null||request.stockCurrent?.stockProtocol!==undefined)throw Error('Warehouse inventory mode changed. Refresh the retained receipt.');
      return saveLegacy();
    }
    if(control.mode!=='ACTIVE')throw Error('Warehouse inventory maintenance. Retain the original receipt.');
    // Same-request resume owns pending validation inside the current coordinator.
    return saveCurrent(company,{requestId:request.requestId,input:request.input,stockProtocol:request.stockCurrent?.stockProtocol,
      stockBuild:request.stockCurrent?.stockBuild,stockGeneration:request.stockCurrent?.stockGeneration});
  };
}
module.exports={createCurrentWarehouseReceiptRouter};
