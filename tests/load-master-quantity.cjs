const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Run the production client and validator; mock only the external HTTP boundary.
module.exports=function(context,lines){
  const existingFetch=context.fetch;
  context.getSecret=async()=>'LOCAL-TEST-ONLY';
  context.fetch=async(url,options)=>{
    if(!url.endsWith('/purchaseQuantities')){
      if(existingFetch)return existingFetch(url,options);
      throw Error('Unexpected external request: '+url);
    }
    const request=JSON.parse(options.body);
    return {ok:true,json:async()=>({ok:true,customerId:request.customerId,orders:request.orders.map(order=>({...order,lines:lines().filter(line=>line.orderId===order.orderId&&line.customerId===request.customerId&&!line.addedToOrderId).map(line=>({lineId:line.lineId,barcode:line.barcode,committedQtyCtn:line.effectiveRequestedQtyCtn??line.requestedQtyCtn??line.quantityCtn,history:[]}))}))})};
  };
  for(const [file,name] of [['masterQuantityProjection.js','applyMasterQuantities'],['masterQuantityClient.js','withMasterQuantities']]){
    const source=fs.readFileSync(path.join(__dirname,'../backend',file),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export (async function|function) /gm,'$1 ');
    context[name]=vm.runInContext('(function(){'+source+'\nreturn '+name+';})()',context);
  }
};
