'use strict';

const { stockKey } = require('./current-model.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { readCurrentProduct } = require('./current-product-reader.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { currentPackingContext } = require('./current-packing-context.cjs');
const { validateOriginalPacking } = require('./original-packing-validation.cjs');
const { preparePackingStock } = require('./packing-stock-plan.cjs');
const {captureOriginalPackingPhotoPlan}=require('./packing-photo-plan.cjs');
const {prependPackingPhotoReceipts}=require('./packing-photo-fenced-store.cjs');
const {hash}=require('./commit-proof.cjs');
const {readArrangements,linkArrangement,identity:arrangementIdentity}=require('./purchase-arrangement.cjs');
// Private candidate for the existing authenticated read/save gateways. Every read
// shares the company control barrier. No legacy apply or file upload in prepare.
function createPackingStockPreparation(deps) {
  const { company, readMember, readStaffRecords, requirePackingStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, projectPackingContext, createPackingListOperations, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, readPreparation, projectPreparation, items, store, protocol, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requirePackingStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, projectPackingContext, createPackingListOperations, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, now].some(f => typeof f !== 'function') || typeof items?.query !== 'function'
    || typeof store?.read !== 'function' || typeof protocol?.readSnapshot !== 'function') throw Error('Server packing stock dependencies required');
  const current = protocol.planFormat === 'SEGMENTED_V2';
  if (current && typeof deps.readCurrentTaskRows !== 'function') throw Error('Private packing current task reader required');
  async function load(request, save) {
    const photos=save&&request?.input?.action==='PHOTOS';
    if (request?.company !== company || !['SUPPORT', 'WAREHOUSE'].includes(request.department)
      || photos&&(!current||request.department!=='WAREHOUSE'||typeof deps.allocatePhotoSlots!=='function')) throw Error('Supported company/non-photo packing request required until paired file protocol supplied');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePackingStaff(member, [], request.department);
    const staff = requirePackingStaff(member, await readStaffRecords(), request.department), metrics = { queries: 0, exactReads: 0 };
    // Private admission fields from current save, never browser input. Refuse
    // before context reads and photo ID allocation; retain the later check too.
    if (save && (request.staffId !== undefined && request.staffId !== staff.staffId
      || request.memberId !== undefined && request.memberId !== member._id)) throw Error('Original packing employee changed during preparation');
    const snapshot = await protocol.readSnapshot(async control => {
      if (current && (control?.company !== company || control.mode !== 'ACTIVE' || control.pending
        || control.transferIndexVersion !== 2 || !control.writerBuild)) throw Error('Current packing checkpoint/index unavailable');
      const original = await readContext(company, staff);
      if (original?.company !== company || !Array.isArray(original.tasks) || !Array.isArray(original.activity)) throw Error('Original packing company context required');
      const packing = projectPackingContext(original), identities = new Map();
      for (const task of packing.tasks) {
        const source = original.tasks.filter(t => t.id === task.taskId);
        if (source.length !== 1) throw Error('Exact original packing task required');
        const identity = { company, barcode: source[0].barcode, packing: source[0].packing, ea: source[0].ea };
        identities.set(stockKey(identity), identity);
      }
      const orders = projectPurchaseOrders({ company, workspace: original, records: await readPurchaseRecords(company, staff) }), products = [];
      for (const identity of identities.values()) {
        const builder = originalProductState({ company, context: original, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
        const demandTaskIds = packing.tasks.filter(task => {
          const originalTask = original.tasks.find(t => t.id === task.taskId);
          return stockKey({ ...originalTask, company }) === stockKey(identity);
        }).map(task => task.taskId);
        const rows = current ? await readScopedCurrentProduct({ company, identity, items, store, metrics,
          transferIndexVersion: control.transferIndexVersion, demandTaskIds }) : await readCurrentProduct({ company, identity, items, store, metrics });
        if (current) {
          if (!rows.product) throw Error('Current packing product checkpoint missing');
          rows.taskRows = await deps.readCurrentTaskRows(company, builder.scopeTaskIds(rows), staff); rows.generation = control.generation;
        }
        products.push({ state: builder.buildState(rows), rows });
      }
      const context = currentPackingContext({ context: packing, states: products.map(p => p.state) });
      if(current){const instructions=readArrangements(company,original.activity);
        context.tasks=context.tasks.map(task=>({...task,purchaseArrangements:instructions.filter(i=>i.taskId===task.taskId)}));}
      if (context.stockDamageVersion === 1 && deps.currentDamageVersion !== 1) throw Error('Paired original isolated packing model required');
      if (!save) return { context, ...(current ? { stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1,
        stockBuild: control.writerBuild, stockGeneration: control.generation } } : {}) };
      let validated;
      if(photos){
        const at=now(),args={company,staff,requestId:request.requestId,input:request.input,context,createPackingListOperations,now:()=>new Date(at)};
        // Original file/state/history validators BEFORE generated IDs. ALLOCATE
        // creates no file; after manifest publication this capture never reruns.
        await captureOriginalPackingPhotoPlan({...args,slots:(request.input.photos||[]).map((_,index)=>'pending-packing-'+hash(company,request.requestId,staff.memberId,index))});
        validated=await captureOriginalPackingPhotoPlan({...args,slots:await deps.allocatePhotoSlots(request.input.photos.length)});
      }else validated = await validateOriginalPacking({ createPackingListOperations, company, staff, requestId: request.requestId, input: request.input, context, now });
      const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
      metrics.exactReads++;
      const currentRecord = await store.read(journal, validated.record._id), prior = context.lists.find(l => l.id === validated.record.description);
      if (JSON.stringify(currentRecord?.details?.list || null) !== JSON.stringify(prior || null)) throw Error('Packing current record changed');
      // Reuse original stored-list validation, including evidence/bounds, before mapping.
      readPackingLists([{ ...validated.record, company }], company);
      let arrangementPlan;
      if(request.input.purchaseArrangement!==undefined){
        if(!current||request.department!=='SUPPORT'||request.input.action!=='CREATE')throw Error('Purchase instruction requires original Support create');
        const reference=request.input.purchaseArrangement;
        if(!reference||typeof reference.taskId!=='string'||typeof reference.batchId!=='string')throw Error('Exact Purchase instruction reference required');
        const before=await store.read(journal,arrangementIdentity(company,reference.taskId,reference.batchId));
        arrangementPlan=linkArrangement({company,before,reference,list:validated.record.details.list,
          staff:{...staff,memberId:member._id},requestId:request.requestId,at:validated.record.activityTime});
      }
      const lines = new Set([...(prior?.lines || []), ...(prior?.change?.lines || []), ...validated.record.details.list.lines,
        ...(validated.record.details.list.change?.lines || [])].map(l => l.taskId));
      return { validated, currentRecord, arrangementPlan, products: products.filter(p => p.state.tasks.some(t => lines.has(t.id))) };
    });
    const originalStaff={memberId:staff.memberId,staffId:staff.staffId,staffName:staff.staffName,packingDepartment:staff.packingDepartment};
    if (!save) return { ...snapshot.rows, staff:originalStaff, memberId: staff.memberId, generation: snapshot.generation, metrics };
    const mapped=preparePackingStock({ company, ...snapshot.rows, validated:photos?{...snapshot.rows.validated,uploads:[]}:snapshot.rows.validated,generation: snapshot.generation, packingHeld,
      planFormat: current ? 'SEGMENTED_V2' : 'PROOF_V1' });
    if(snapshot.rows.arrangementPlan)mapped.plan.writes.push(...snapshot.rows.arrangementPlan.writes);
    if(photos)mapped.plan=prependPackingPhotoReceipts({company,staff,requestId:request.requestId,input:request.input,prepared:snapshot.rows.validated,plan:mapped.plan});
    return { ...mapped,
      staff:originalStaff, memberId: staff.memberId, generation: snapshot.generation, metrics };
  }
  return { read: request => load(request, false), prepare: request => load(request, true) };
}
module.exports = { createPackingStockPreparation };
