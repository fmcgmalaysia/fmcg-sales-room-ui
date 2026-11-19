  function openDeskSplit(taskId){
    const line=data.orders.flatMap(order=>order.lines).find(line=>line.taskId===taskId);if(!line||deskBusy||deskPending())return;
    const assignment=deskState().assignments.find(row=>row.taskId===taskId),total=line.orderQty-line.invoicedQty,parts=line.deskPortions?.length?line.deskPortions:assignment?.parts||[{desk:assignment?.desk||0,quantity:total}];
    const unassigned=Math.max(0,(parts.find(part=>part.desk===0)?.quantity||0)-(parts.find(part=>part.desk===0)?.invoiced||0));
    const sources=parts.filter(part=>part.desk>0&&part.quantity>(part.invoiced||0));
    if(!sources.length&&!unassigned)return;
    if(!deskSplitDialog){deskSplitDialog=document.createElement('dialog');deskSplitDialog.className='desk-split-dialog';document.body.append(deskSplitDialog);}
    const currentQty=part=>part.quantity-(part.invoiced||0);
    deskSplitDialog.setAttribute('aria-labelledby','desk-split-title');
    deskSplitDialog.innerHTML=`<form>
      <header class="dialog-header"><h2 id="desk-split-title">Split shipment 分批出货</h2><button type="button" data-close aria-label="Close">×</button></header>
      <div class="split-body"><b>${esc(line.name)}</b>
      ${sources.length?`<div class="split-quantities">
        <div class="split-quantity-row split-quantity-head"><span>Desk</span><span>Current Qty <small>原数量</small></span><span>Keep in Desk <small>保留数量</small></span></div>
        ${sources.map(part=>`<div class="split-quantity-row">
          <span>Desk ${part.desk}</span><strong>${number(currentQty(part))} CTN</strong>
          <input aria-label="Keep in Desk ${part.desk} 保留数量" data-part="${part.desk}" type="number" inputmode="numeric" step="1" value="${currentQty(part)}">
        </div>`).join('')}
      </div>`:''}
      ${unassigned?`<details><summary>Assign pending 安排待办 · ${number(unassigned)} CTN</summary><label>Qty<input data-assign-qty type="number" min="0" max="${unassigned}" step="1" value="0"></label><label>Desk<select data-assign-desk><option value="">Choose Desk</option>${[1,2,3].map(desk=>'<option value="'+desk+'">Desk '+desk+'</option>').join('')}</select></label></details>`:''}
      <div class="split-pending"><span>Pending after split <small>拆分后待安排</small></span><strong id="split-pending-qty" aria-live="polite"></strong></div>
      <p id="split-status" role="status"></p></div>
      <footer><button type="button" data-close>Cancel 取消</button><button type="submit" class="primary">Confirm 确认</button></footer>
    </form>`;
    const form=deskSplitDialog.querySelector('form'),button=form.querySelector('[type=submit]');let saving=false;
    const fields=()=>[...form.querySelectorAll('[data-part]')];
    const locked=input=>input.min===input.max||data.deskLocks.some(lock=>lock.customerId===selectedCustomer&&lock.desk===Number(input.dataset.part)&&lock.status!=='ISSUED');
    for(const input of fields()){
      const desk=Number(input.dataset.part),part=parts.find(row=>row.desk===desk),floor=(data.delivery?.lists||[]).filter(list=>list.desk?.number===desk&&!['DRAFT','CANCELLED'].includes(list.status)).flatMap(list=>list.lines.filter(row=>row.taskId===taskId)).reduce((n,row)=>n+(row.resolution?.maximum??row.quantity),0);
      input.max=String(currentQty(part));
      const movable=Math.max(0,part.quantity-Math.max(floor,part.invoiced||0));
      input.min=String(currentQty(part)-movable);
      input.disabled=locked(input);
    }
    const splitTotal=()=>fields().reduce((sum,input)=>sum+Number(input.max)-Number(input.value),0);
    const assignQty=()=>Number(form.querySelector('[data-assign-qty]')?.value||0),assignDesk=()=>Number(form.querySelector('[data-assign-desk]')?.value||0);
    const preview=()=>{
      const split=splitTotal(),assign=assignQty();
      const valid=Number.isSafeInteger(assign)&&assign>=0&&assign<=unassigned&&fields().every(input=>{
        const keep=Number(input.value);
        return input.value.trim()&&Number.isSafeInteger(keep)&&keep>=Number(input.min)&&keep<=Number(input.max);
      });
      form.querySelector('#split-pending-qty').textContent=valid?number(unassigned+split-assign)+' CTN':'—';
      button.disabled=!valid||split+assign<=0||(assign>0&&![1,2,3].includes(assignDesk()));
    };
    form.querySelector('[data-assign-qty]')?.addEventListener('input',preview);form.querySelector('[data-assign-desk]')?.addEventListener('change',preview);
    fields().forEach(input=>input.oninput=preview);form.querySelectorAll('[data-close]').forEach(close=>close.onclick=()=>{if(!saving&&!deskPending())deskSplitDialog.close();});deskSplitDialog.oncancel=event=>{if(saving||deskPending())event.preventDefault();};
    form.onsubmit=async event=>{event.preventDefault();if(saving)return;const retained=deskPending();if(!retained)preview();if(button.disabled)return;saving=true;button.disabled=true;
      const moved=splitTotal(),next=parts.filter(part=>part.desk!==0).map(part=>{
        const keep=form.querySelector('[data-part="'+part.desk+'"]');
        return {desk:part.desk,quantity:keep?Number(keep.value)+(part.invoiced||0):part.quantity};
      });
      if(assignQty()){const target=next.find(part=>part.desk===assignDesk());if(target)target.quantity+=assignQty();else next.push({desk:assignDesk(),quantity:assignQty()});}
      next.push({desk:0,quantity:(parts.find(part=>part.desk===0)?.quantity||0)+moved-assignQty()});fields().forEach(input=>input.disabled=true);form.querySelector('[data-assign-qty]')?.setAttribute('disabled','');form.querySelector('[data-assign-desk]')?.setAttribute('disabled','');
      const ok=await saveDeskChange(retained?.input||{action:'DESK_SPLIT',customerId:selectedCustomer,taskId,desk:assignment?.desk||0,revision:deskState().revision,parts:next.filter(part=>part.quantity>0)},'split-status');saving=false;button.disabled=false;
      if(ok){deskSplitDialog.close();await load([0,1,2]);}else if(deskPending())button.textContent='Retry same save 重试本次保存';else{fields().forEach(input=>input.disabled=locked(input));preview();}
    };preview();deskSplitDialog.showModal();
  }
