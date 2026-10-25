'use strict';
const fs = require('node:fs'), path = require('node:path');
const { collectionTokens } = require('./isolated-cohort.cjs');
const body = collectionTokens(fs.readFileSync(path.join(__dirname, 'r2-borrow-repayment-acceptance.cjs'), 'utf8').replace(/\r\n/g, '\n')
  .replace(/^'use strict';\n/, '').replace(/module.exports = \{ verifyR2BorrowRepayment \};\s*$/, ''), 'MASTER');
const source = `import { items } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { createHash } from 'crypto';
import { createSdkConditionalStore, createSegmentedFencedProof, createCurrentBorrowingSave, createCurrentWarehouseReceiptSave } from 'backend/r2stockCurrentCommands.js';
import { requirePurchaseStaff } from 'backend/r2purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/r2purchaseOrderWorkflow.js';
import { requireWarehouseStaff, projectWarehouseOrders, createWarehouseOperations, readWarehouseTask } from 'backend/r2warehouseReceiving.js';
import { readAllocations } from 'backend/r2plannerAllocation.js';
import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
import { readPackingLists } from 'backend/r2packingListOperations.js';
import { packingHeld } from 'backend/r2packingListModel.js';
const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const copy=value=>JSON.parse(JSON.stringify(value));
const runtime={createSdkConditionalStore,createSegmentedFencedProof,createCurrentBorrowingSave,createCurrentWarehouseReceiptSave};
const original={requirePurchaseStaff,projectPurchaseOrders,requireWarehouseStaff,projectWarehouseOrders,createWarehouseOperations,readWarehouseTask,readAllocations,readCustomerShipments,readPackingLists,packingHeld,
  stockKey:({company,barcode,packing,ea})=>JSON.stringify([company,barcode,packing,ea])};
` + body + `
const R2_BORROW_REPAYMENT_ENABLED=false;
export const verifyR2Borrowing=webMethod(Permissions.Admin,async input=>{const result=await verifyR2BorrowRepayment({items,runtime,original,hash,copy,input,enabled:R2_BORROW_REPAYMENT_ENABLED});console.info('R2BORROW_RECEIPT '+JSON.stringify(result));return result;});
`;
if (require.main === module) {
  new Function(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
  const target = path.join(__dirname, 'r2BorrowRepaymentAcceptance.web.js');
  if (process.argv.includes('--check')) { if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Borrow acceptance diagnostic drift'); }
  else fs.writeFileSync(target, source);
  process.stdout.write('Borrow/receipt composition compiled CLOSED, StockProtocolTest only, no delete/activation capability\n');
}
module.exports = { source };
