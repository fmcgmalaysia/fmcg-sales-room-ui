import { projectCustomerAccount } from 'backend/customerDebtor.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
// Read-only projection. Purchase cost and FX come only from the issued invoice snapshot.
export function projectSalesDepartment({company,activity,customerIds}){
 if(!['NCT','GHR'].includes(company)||!Array.isArray(customerIds)||customerIds.length>200||customerIds.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(customerIds).size!==customerIds.length)throw Error('Invalid authorized customer scope.');
 const allowed=new Set(customerIds),account=projectCustomerAccount({company,activity}),shipments=new Map(readCustomerShipments(activity).filter(row=>row.company===company).map(row=>[row.id,row]));
 const invoices=account.invoicePayments.invoices.filter(row=>allowed.has(row.customerId)).map(row=>{
  const shipment=shipments.get(row.id);let costCents=null,revenueMyrCents=null;
  if(shipment&&shipment.lines.every(line=>Array.isArray(line.costSources)&&line.costSources.length&&line.costSources.every(source=>Number.isSafeInteger(source.quantity)&&source.quantity>0&&Number.isFinite(source.netCostCtn)&&source.netCostCtn>=0)&&line.costSources.reduce((n,source)=>n+source.quantity,0)===line.quantity)){
   const amount=shipment.lines.reduce((n,line)=>n+line.costSources.reduce((v,source)=>v+source.quantity*source.netCostCtn,0),0);costCents=Math.round(amount*100);if(!Number.isSafeInteger(costCents))throw Error('Invoice cost exceeds supported precision.');
  }
  if(shipment&&Number.isFinite(shipment.invoice.rateToMyr)&&shipment.invoice.rateToMyr>0){revenueMyrCents=Math.round(row.amountCents*shipment.invoice.rateToMyr);if(!Number.isSafeInteger(revenueMyrCents))throw Error('Invoice revenue exceeds supported precision.');}
  const profitCents=costCents!==null&&revenueMyrCents!==null&&row.creditCents===0&&row.debitCents===0?revenueMyrCents-costCents:null;
  return {id:row.id,company,customerId:row.customerId,kind:row.kind,number:row.number,date:row.date,period:row.date.slice(0,7),currency:row.currency,amountCents:row.amountCents,paidCents:row.paidCents,dueCents:row.dueCents,creditCents:row.creditCents,debitCents:row.debitCents,costCents,revenueMyrCents,profitCents,gp:profitCents!==null&&revenueMyrCents>0?profitCents/revenueMyrCents:null,profitBasis:shipment?'INVOICE_FX':'UNAVAILABLE',transportCostCents:null,commissionStatus:'PENDING',commissionEligible:row.dueCents===0&&row.paidCents>0,commissionReviewRequired:profitCents===null||row.kind!=='GOODS',otherCostCents:null,netCommissionCents:null};
 }).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 return {company,invoices,balances:account.balances.filter(row=>allowed.has(row.customerId)).map(row=>({company,customerId:row.customerId,currency:row.currency,balanceCents:row.balanceCents})),readAt:new Date().toISOString()};
}
