'use strict';
const assert=require('node:assert/strict');
function edit(source){return (before,after)=>{assert.equal(source.split(before).length,2,'unique display hunk: '+before.slice(0,90));source=source.replace(before,()=>after);return source;};}
function patchGrid(source){
 const replace=(before,after)=>{source=edit(source)(before,after);};
 replace("    const planned=new Map(group.map(source=>[source.id,batchId?(entitlement?.sources||[]).filter(item=>item.id===source.id).reduce((n,item)=>n+item.quantity,0):totals([source]).customerQty]));",`    const sourceAssigned={},originalPurchase=group.reduce((n,source)=>n+totals([source]).customerQty,0);
    const planned=new Map(group.map(source=>{
      const saved=allocations.find(item=>item.sourceTaskId===source.id),target=saved?.targets?.find(item=>item.taskId===row.id),original=totals([source]).customerQty;
      const elsewhere=(saved?.targets||[]).filter(item=>item.taskId!==row.id).reduce((n,item)=>n+item.quantity,0);
      const redirected=Math.max(0,elsewhere-Math.max(0,(source.procurement?.totalCtn||0)-original));
      const hasIncoming=allocations.some(item=>!group.some(own=>own.id===item.sourceTaskId)&&item.targets?.some(target=>target.taskId===row.id&&target.quantity>0));
      const ownedPlan=Math.min(Math.max(0,original-redirected),hasIncoming&&saved?(target?.quantity||0):original),earmark=batchId?(entitlement?.sources||[]).filter(item=>item.id===source.id).reduce((n,item)=>n+item.quantity,0):original;
      sourceAssigned[source.id]=target?.quantity??(saved?0:original);
      const contribution=batchId&&redirected>0?Math.min(earmark,(target?.batches||[]).filter(item=>item.id===batchId).reduce((n,item)=>n+item.quantity,0)):Math.min(earmark,ownedPlan);
      return [source.id,contribution];
    }));`);
 replace('return {entries,stock,purchase,covered:purchase+stock,remaining:Math.max(0,demand-purchase-stock)};','return {entries,stock,purchase,originalPurchase,sourceAssigned,covered:purchase+stock,remaining:Math.max(0,demand-purchase-stock)};');
 replace("const problem=position?.quarantined===true,label=problem?'Stock review 库存待核对':loans.length?'Borrowed Stock 借入库存':'Ready Stock 现有库存';",`const replenished=(allocationContext?.loans||[]).some(loan=>loan.lenderTaskId===row.id&&loan.borrowerTaskId===(source?.customerDemandTaskId||source?.id)&&loan.quantity-loan.outstanding>=entry.quantity);
        const problem=position?.quarantined===true,label=problem?'Stock review 库存待核对':loans.length?'Borrowed Stock 借入库存':replenished?'Replenished Stock 补回库存':'Ready Stock 现有库存';`);
 replace('      if(active)qtyMarkup=qtyMarkup.replace(/<button class="quantity-case',`      if(child){const actual=coverage(parent).sourceAssigned[original.id],ordered=totals([original]).customerQty;if(Number.isSafeInteger(actual)&&actual!==ordered){product+='<small class="source-contribution">Original PO 原采购 '+quantity(original.procurement.totalCtn)+' · Customer source 本客户来源 <b>'+quantity(actual)+'</b> CTN</small>';qtyMarkup=qtyMarkup.replace(/(<td class="order-quantity">)([\\s\\S]*?)(<\\/td>)/,(_,open,value,close)=>open+'<span class="source-actual" aria-label="Customer source 本客户来源 '+quantity(actual)+' CTN">'+quantity(actual)+'</span><small class="source-original">PO '+value+'</small>'+close);}}
      if(active)qtyMarkup=qtyMarkup.replace(/<button class="quantity-case`);
 return source;
}
function patchAllocation(source){
 return edit(source)("const fields=[['Allocated from stock 库存覆盖',quantity(entry.quantity)+' CTN'],", "const fields=[['Customer source 本客户来源',quantity(entry.quantity)+' CTN'],['Original P.O. quantity 原采购数量',quantity(source?.procurement?.totalCtn)+' CTN'],");
}
const style=`\n/* Original purchasing quantities and confirmed customer ownership are distinct. */\n.source-row .source-contribution{display:block;color:#587087;font-size:10px;line-height:15px;font-weight:400;white-space:normal}.source-contribution b{font-weight:600;color:#173557}\n.source-row .source-original{display:block;color:#587087;font-size:10px;line-height:15px;white-space:nowrap}.source-row .source-original button{font-size:10px}.source-row .source-actual{font-size:11px;font-weight:600}\n`;
module.exports={patchGrid,patchAllocation,style};
