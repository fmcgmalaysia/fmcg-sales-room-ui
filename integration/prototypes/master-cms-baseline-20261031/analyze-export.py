"""Local-only analysis of explicit Wix UI CSV exports; no network or writes to Wix."""
import csv, json, collections, hashlib, pathlib, sys

folder = pathlib.Path(sys.argv[1])
def read(name):
    with (folder / (name + '.csv')).open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))

raw = {name: read(name) for name in ['NCTActivity', 'NCTOrders', 'NCTTasks', 'PurchaseOrders']}
common = {'ID':'_id','Created Date':'_createdDate','Updated Date':'_updatedDate','Owner':'_owner'}
activity_map = {'Activity ID':'title','Order ID':'description','Source Line ID':'image','Task ID':'imageAltText','Action':'action','Activity Time':'activityTime','Actor Type':'actorType','Initiated By Staff ID':'initiatedByStaffId','Initiated By Staff Name':'initiatedByStaffName','Message':'message','Result':'result','Details':'details'}
order_map = {'Order ID':'title','Customer ID':'customerId','Customer Company Name':'customerCompanyName','Unit Barcode':'description','Item Name':'image','Packing Size':'imageAltText','EA':'orderId','Order Qty In Ctn':'orderQtyInCtn','Selling Price / Pc':'sellingPricePc','FX Rate':'adminFxSource','Transaction Currency':'transactionCurrency','Submitted By Staff ID':'submittedByStaffId','Submitted By Staff Name':'submittedByStaffName','Customer PO Number':'customerPoNumber','Buyer Received By':'buyerReceivedBy','Submission ID':'submissionId','Intake Status':'intakeStatus','Source Site ID':'sourceSiteId','Sales Invoice Number':'salesInvoiceNumber','Financial Locked By':'financialLockedBy','Estimated Shipment Date':'estimatedShipmentDate','CBM / Ctn':'cbmCtn','Master Received Time':'masterReceivedTime','Sales Submission Time':'salesSubmissionTime','Source Line ID':'sourceLineId','GP':'gp','Sales Invoice Summary':'salesInvoiceSummary'}
task_map = {'Task ID':'title','Order ID':'description','Source Line ID':'imageAltText','Row Position':'rowPosition','Supplier ID':'supplierId','Our PO Number':'ourPoNumber','Purchase Qty In Ctn':'purchaseQtyInCtn','Received Qty In Ctn':'receivedQtyInCtn','LP / Pc':'lpPc','LP / Ctn':'lpCtn','Disc 1':'disc1','Disc 2':'disc2','Disc 3':'disc3','Original Cost Snapshot':'originalCostSnapshot','Latest Cost Reference':'latestCostReference','Cost Status':'costStatus','Cost Error Reason':'costErrorReason','Last Cost Capture Time':'lastCostCaptureTime','Manual Cost Field':'manualCostField','Purchase Stage':'purchaseStage','Risk':'risk','Risk Reason':'riskReason','Special Purchase':'specialPurchase','Special Purchase Reason':'specialPurchaseReason','Procurement Source':'procurementSource','Customer Demand Task ID':'customerDemandTaskId'}
json_fields = {'details','originalCostSnapshot','latestCostReference','manualCostField','salesInvoiceSummary'}
numeric_fields = {'orderId','orderQtyInCtn','sellingPricePc','adminFxSource','cbmCtn','gp','rowPosition','purchaseQtyInCtn','receivedQtyInCtn','lpPc','lpCtn','disc1','disc2','disc3'}
boolean_fields = {'risk','specialPurchase','procurementSource'}
def convert(rows, mapping):
    result=[]
    for row in rows:
        target={}
        for label,key in (common | mapping).items():
            if label not in row: continue
            value=row[label]
            if key in json_fields: value=json.loads(value) if value else ([] if key in {'manualCostField','salesInvoiceSummary'} else None)
            elif key in numeric_fields: value=float(value.removeprefix("'")) if value else None
            elif key in boolean_fields: value=value.lower()=='true'
            target[key]=value
        result.append(target)
    return result
data={'activity':convert(raw['NCTActivity'],activity_map),'orders':convert(raw['NCTOrders'],order_map),'tasks':convert(raw['NCTTasks'],task_map),'purchaseRecords':convert(raw['PurchaseOrders'],{'Title':'title','Company':'company','Details':'details'})}
actions=collections.Counter(row['action'] for row in data['activity'])
prepared=[row for row in data['activity'] if row['action']=='PURCHASE_OPERATION_PREPARED']
results=[row for row in data['activity'] if row['action']=='PURCHASE_OPERATION_RESULT']
ids={row['_id']:row for row in results}
missing=[]
for row in prepared:
    expected=hashlib.sha256(json.dumps([row['_id'],'RESULT'],separators=(',',':')).encode()).hexdigest()[:32]
    if expected not in ids or ids[expected]['details'].get('digest')!=row['details'].get('digest'): missing.append(row['_id'])
classification={'operationPrepared':len(prepared),'operationResult':len(results),'recoveryClaims':actions['PURCHASE_OPERATION_RECOVERY'],'remainingActivity':len(data['activity'])-len(prepared)-len(results)-actions['PURCHASE_OPERATION_RECOVERY']}
summary={'kind':'LIVE_UI_EXPORT_ANALYSIS','rawCounts':{key:len(value) for key,value in raw.items()},'actions':dict(actions),'classification':classification,'preparedWithoutMatchingResultCount':len(missing),'liveOperationLockCount':sum(row['action']=='PURCHASE_OPERATION_LOCK' for row in data['activity']),'recoveryClaimStates':dict(collections.Counter(row['result'] for row in data['activity'] if row['action']=='PURCHASE_OPERATION_RECOVERY')),'orderCount':actions['ORDER_RECEIVED'],'intakeLineCounts':sorted(len(row['details']['sourceSnapshot']['lines']) for row in data['activity'] if row['action']=='INTAKE_PREPARED'),'initialCostRows':actions['COST_CAPTURE'],'sourceTaskExtra':len(data['tasks'])-len(data['orders']),'gpRecalculationRows':actions['GP_RECALCULATED'],'historicalRowMoveEvents':actions['PURCHASE_ROW_MOVED'],'sha256':{name:hashlib.sha256((folder/(name+'.csv')).read_bytes()).hexdigest() for name in raw}}
(folder/'export-analysis.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf8')
# Private data stays in the task evidence folder and is never committed.
(folder/'private-dataset.json').write_text(json.dumps(data,separators=(',',':'))+'\n',encoding='utf8')
print(json.dumps(summary,indent=2))
