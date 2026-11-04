'use strict';
// Private optional-context seam only, original3argument flow unchanged.
const fs = require('node:fs'), path = require('node:path');
let source = fs.readFileSync(path.join(__dirname, '../../backend/customerFulfilmentService.js'), 'utf8').replace(/\r\n/g, '\n');
const old = "export async function readCustomerFulfilment(company,staff,customerId=''){\n const context=await readFulfilmentContext(company,staff),shipments=";
const next = "export const CUSTOMER_CURRENT_FULFILMENT_VERSION = 2;\nexport async function readCustomerFulfilment(company,staff,customerId='',currentContext=null){\n if(currentContext!==null&&(currentContext.company!==company||currentContext.stockAllocationView!=='CURRENT_V2'||staff.customerId!==customerId&&!(customerId===''&&!staff.customerId&&(staff.canDispatchShipment===true||staff.readFinancial===true))))throw Error('Verified current customer context required.');\n const context=currentContext===null?await readFulfilmentContext(company,staff):currentContext,shipments=";
if (source.split(old).length !== 2) throw Error('Original customer fulfilment read anchor changed');
source = source.replace(old, next);
const target = path.join(__dirname, 'customerFulfilmentService.candidate.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Current customer fulfilment candidate differs');
} else fs.writeFileSync(target, source);
process.stdout.write('Original Sales read context seam ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; no live edits\n');
