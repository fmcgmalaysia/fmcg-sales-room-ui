import { handleTaskChat } from 'public/taskChatBridge.js';
import { getPurchaseWorkspace } from 'backend/purchaseWorkspace.web';
import { getStockExceptions, saveStockException, getDepartmentMessages, saveDepartmentMessage } from 'backend/stockExceptions.web';
import { getPurchaseOrders, savePurchaseOrder } from 'backend/purchaseOrders.web';
import { retryPurchaseTaskCost } from 'backend/purchaseCostRetry.web';
import { savePurchaseOperation, getSupplierProfile, getSupplierBrandOptions, saveSupplierProfile, getPurchaseSaveResult, getPurchaseReferenceCost } from 'backend/purchaseOperations.web';
import { authentication, currentMember } from 'wix-members-frontend';
const UI_ORIGIN = 'https://fmcgmalaysia.github.io';
$w.onReady(() => {
  const room = $w('#html1');
  room.onMessage(async event => {
    const message = event.data || {};
    if(['TASK_CHAT_LIST_REQUEST','TASK_CHAT_PAGE_REQUEST','TASK_CHAT_SAVE_REQUEST'].includes(message.type)&&await handleTaskChat(message,'PURCHASE',result=>room.postMessage(result)))return;
    if(message.type==='PURCHASE_REFERENCE_REQUEST'){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||typeof message.taskId!=='string'||message.taskId.length>100)return;
      try{const result=await getPurchaseReferenceCost(message.company,message.taskId);room.postMessage({type:'PURCHASE_REFERENCE_RESULT',company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type:'PURCHASE_REFERENCE_RESULT',company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Reference cost could not be read; inputs retained.'});}return;
    }
    if(['DEPARTMENT_MESSAGES_REQUEST','DEPARTMENT_MESSAGE_SAVE_REQUEST'].includes(message.type)){
      if(!['NCT','GHR'].includes(message.company)||message.department!=='PURCHASE'||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>200000)return;
      const type=message.type==='DEPARTMENT_MESSAGES_REQUEST'?'DEPARTMENT_MESSAGES_RESULT':'DEPARTMENT_MESSAGE_SAVE_RESULT';
      try{const result=message.type==='DEPARTMENT_MESSAGES_REQUEST'?await getDepartmentMessages(message.company,message.department):await saveDepartmentMessage(message.company,message.department,message.requestId,message.input);room.postMessage({type,company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type,company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Messages could not be confirmed.'});}return;
    }
    if(['STOCK_READ_REQUEST','STOCK_SAVE_REQUEST'].includes(message.type)){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>200000)return;
      const type=message.type==='STOCK_READ_REQUEST'?'STOCK_READ_RESULT':'STOCK_SAVE_RESULT';
      try{const result=message.type==='STOCK_READ_REQUEST'?await getStockExceptions(message.company):await saveStockException(message.company,message.requestId,message.input);room.postMessage({type,company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type,company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Stock request could not be confirmed.'});}return;
    }
    if(['PURCHASE_ORDERS_REQUEST','PURCHASE_ORDER_SAVE_REQUEST'].includes(message.type)) {
      const maxSize=message.type==='PURCHASE_ORDER_SAVE_REQUEST'&&message.input?.action==='DOCUMENT'?4250000:200000;
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>maxSize)return;
      const replyType=message.type==='PURCHASE_ORDERS_REQUEST'?'PURCHASE_ORDERS_RESULT':'PURCHASE_SAVE_RESULT';
      try {
        const result=message.type==='PURCHASE_ORDERS_REQUEST'?await getPurchaseOrders(message.company):await savePurchaseOrder(message.company,message.requestId,message.input);
        room.postMessage({type:replyType,ok:true,company:message.company,requestId:message.requestId,result});
      } catch(error) {room.postMessage({type:replyType,ok:false,company:message.company,requestId:message.requestId,error:error?.message||'Purchase order request could not be confirmed.'});}
      return;
    }
    if(['PURCHASE_SAVE_REQUEST','PURCHASE_SUPPLIER_SAVE_REQUEST','PURCHASE_PROFILE_REQUEST','PURCHASE_BRANDS_REQUEST','PURCHASE_SAVE_CHECK_REQUEST'].includes(message.type)) {
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>200000)return;
      const replyType={PURCHASE_PROFILE_REQUEST:'PURCHASE_PROFILE_RESULT',PURCHASE_BRANDS_REQUEST:'PURCHASE_BRANDS_RESULT',PURCHASE_SAVE_CHECK_REQUEST:'PURCHASE_SAVE_CHECK_RESULT'}[message.type]||'PURCHASE_SAVE_RESULT';
      try {
        let result;
        if(message.type==='PURCHASE_SAVE_REQUEST')result=await savePurchaseOperation(message.company,message.requestId,message.operation,message.input);
        else if(message.type==='PURCHASE_SUPPLIER_SAVE_REQUEST')result=await saveSupplierProfile(message.requestId,message.supplierId,message.expectedVersion,message.values);
        else if(message.type==='PURCHASE_PROFILE_REQUEST')result=await getSupplierProfile(message.supplierId);
        else if(message.type==='PURCHASE_BRANDS_REQUEST')result=await getSupplierBrandOptions();
        else result=await getPurchaseSaveResult(message.company,message.saveRequestId,message.supplierId??null);
        room.postMessage({type:replyType,ok:true,company:message.company,requestId:message.requestId,result});
      } catch(error) {room.postMessage({type:replyType,ok:false,company:message.company,requestId:message.requestId,error:error?.message||'Save could not be confirmed.'});}
      return;
    }
    if (message.type === 'PURCHASE_COST_RETRY_REQUEST' && ['NCT','GHR'].includes(message.company)) {
      try {
        const result = await retryPurchaseTaskCost(message.company, message.taskId, message.requestId);
        room.postMessage({ type: 'PURCHASE_COST_RETRY_RESULT', ...result });
      } catch (error) {
        room.postMessage({ type: 'PURCHASE_COST_RETRY_RESULT', ok: false, company: message.company, taskId: message.taskId,
          requestId: message.requestId, error: error?.message || 'Cost retry could not be confirmed.' });
      }
      return;
    }
    if (message.type === 'PURCHASE_LOGIN_REQUEST') {
      authentication.promptLogin({ mode: 'login', modal: true })
        .then(() => room.postMessage({ type: 'PURCHASE_LOGIN_RESULT', ok: true }))
        .catch(() => room.postMessage({ type: 'PURCHASE_LOGIN_RESULT', ok: false, error: 'Login was not completed.' }));
      return;
    }
    if (message.type !== 'PURCHASE_WORKSPACE_REQUEST' || !['NCT', 'GHR'].includes(message.company) ||
        typeof message.requestId !== 'string' || message.requestId.length > 100) return;
    try {
      if (!authentication.loggedIn()) {
        room.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: message.requestId, company: message.company,
          ok: false, canLogin: true, error: 'Please sign in to Master with your staff account.' });
        return;
      }
      const workspace = await getPurchaseWorkspace(message.company);
      room.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: message.requestId, company: message.company, ok: true, workspace });
    } catch (error) {
      let identity;
      try { const member = await currentMember.getMember({ fieldsets: ['FULL'] }); if (member?._id) identity = { memberId: member._id, email: member.loginEmail }; } catch {}
      room.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: message.requestId, company: message.company,
        ok: false, identity, error: error?.message || 'Purchase data could not be loaded.' });
    }
  });
  room.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/purchase-live/?v=20261031-purchase-quantity-style-v1';
});
