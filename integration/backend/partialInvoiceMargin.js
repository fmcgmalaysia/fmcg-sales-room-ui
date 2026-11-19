export function partialInvoiceMargin({quantity,sellingPricePc,eaPerCtn,netCostCtn,rateToMyr,invoiceLines}){
 if(!Number.isSafeInteger(quantity)||quantity<0)return null;const invoiced=invoiceLines.reduce((sum,line)=>sum+line.quantity,0);if(invoiced>quantity)return null;
 let revenue=0,cost=0;
 for(const line of invoiceLines){if(!Number.isSafeInteger(line.quantity)||line.quantity<=0||!(line.sellingPriceCtn>0)||!(line.rateToMyr>0)||!Array.isArray(line.costSources)||line.costSources.some(source=>!Number.isSafeInteger(source.quantity)||source.quantity<=0||!Number.isFinite(source.netCostCtn)||source.netCostCtn<0)||line.costSources.reduce((sum,source)=>sum+source.quantity,0)!==line.quantity)return null;revenue+=line.quantity*line.sellingPriceCtn*line.rateToMyr;cost+=line.costSources.reduce((sum,source)=>sum+source.quantity*source.netCostCtn,0);}
 const remaining=quantity-invoiced;if(remaining){if(!(sellingPricePc>0)||!Number.isSafeInteger(eaPerCtn)||eaPerCtn<=0||!Number.isFinite(netCostCtn)||netCostCtn<0||!(rateToMyr>0))return null;revenue+=remaining*sellingPricePc*eaPerCtn*rateToMyr;cost+=remaining*netCostCtn;}
 return revenue>0&&Number.isFinite(revenue)&&Number.isFinite(cost)?(revenue-cost)/revenue:null;
}
