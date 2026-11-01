import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { validateInvoiceOutflows } from 'backend/physicalOutflow.js';

// One read-only eligibility rule for customer history and active quantities.
// A historical dispatch is existing evidence; a modern invoice must retain its
// exact confirmed Loaded references. This never creates a dispatch or movement.
export function readLoadedInvoiceRecords(activity,shipments=readCustomerShipments(activity)){
 return shipments.filter(shipment=>{
  if(!['INVOICED','DISPATCHED'].includes(shipment.status))return false;
  if(shipment.status==='DISPATCHED'&&shipment.lines.every(line=>line.physicalOutflowRefs===undefined))return true;
  if(shipment.lines.some(line=>line.physicalOutflowRefs===undefined))return false;
  validateInvoiceOutflows({company:shipment.company,activity},shipment);
  return true;
 });
}
