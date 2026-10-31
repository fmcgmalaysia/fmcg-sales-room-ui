import { handleTaskChat } from 'public/taskChatBridge.js';
import { getCustomerFulfilment } from 'backend/customerFulfilment.web';
import { getStockExceptions, saveStockException, getDepartmentMessages, saveDepartmentMessage } from 'backend/stockExceptions.web';
import { getAccountPurchaseOrders, queryAccountPurchaseOrders, planAccountReadIndex, maintainAccountReadIndex, saveAccountInvoiceCheck, saveAccountSettlement } from 'backend/accountPurchase.web';
import { authentication } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { getFinanceStockList } from 'backend/stockValuation.web';
// PO read and final-Invoice review; payment ledger and Warehouse closure remain unconnected.
$w.onReady(() => {
  const room=$w('#html1');
  room.onMessage(async event=>{
    const message=event.data||{};
    if(message.type==='FINANCE_STOCK_LIST_READ_REQUEST'){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||!message.requestId||message.requestId.length>100||JSON.stringify(message).length>2000)return;
      try{const result=await getFinanceStockList(message.company,message.input||{});room.postMessage({type:'FINANCE_STOCK_LIST_READ_RESULT',company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type:'FINANCE_STOCK_LIST_READ_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Stock could not be confirmed. Refresh the stock list or check your Finance access.'});}return;
    }
    if(['TASK_CHAT_LIST_REQUEST','TASK_CHAT_PAGE_REQUEST','TASK_CHAT_SAVE_REQUEST'].includes(message.type)&&await handleTaskChat(message,'ACCOUNT',result=>room.postMessage(result)))return;
    if(['DEPARTMENT_MESSAGES_REQUEST','DEPARTMENT_MESSAGE_SAVE_REQUEST'].includes(message.type)){
      if(!['NCT','GHR'].includes(message.company)||message.department!=='ACCOUNT'||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>200000)return;
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
    if(message.type==='ACCOUNT_LOGIN_REQUEST'){
      try{await authentication.promptLogin({mode:'login',modal:true});room.postMessage({type:'ACCOUNT_LOGIN_RESULT',ok:true});}
      catch(_){room.postMessage({type:'ACCOUNT_LOGIN_RESULT',ok:false});}return;
    }
    if(message.type==='ACCOUNT_CUSTOMER_LEDGER_REQUEST'){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100)return;
      try{const result=await getCustomerFulfilment(message.company);room.postMessage({type:'ACCOUNT_CUSTOMER_LEDGER_RESULT',company:message.company,requestId:message.requestId,ok:true,result});}catch(error){room.postMessage({type:'ACCOUNT_CUSTOMER_LEDGER_RESULT',company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Customer ledger could not be loaded.'});}return;
    }
    if(message.type==='ACCOUNT_QUERY_REQUEST'){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||!message.input||JSON.stringify(message.input).length>5000)return;
      try{const result=await queryAccountPurchaseOrders(message.company,message.input);room.postMessage({type:'ACCOUNT_QUERY_RESULT',company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type:'ACCOUNT_QUERY_RESULT',company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Account records could not be loaded.'});}return;
    }
    if(['ACCOUNT_INDEX_PLAN_REQUEST','ACCOUNT_INDEX_MAINTAIN_REQUEST'].includes(message.type)){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>1000)return;
      const type=message.type==='ACCOUNT_INDEX_PLAN_REQUEST'?'ACCOUNT_INDEX_PLAN_RESULT':'ACCOUNT_INDEX_MAINTAIN_RESULT';
      try{const result=message.type==='ACCOUNT_INDEX_PLAN_REQUEST'?await planAccountReadIndex(message.company):await maintainAccountReadIndex(message.company,message.action,message.generation);room.postMessage({type,company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type,company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Account read index request could not be confirmed.'});}return;
    }
    if(!['ACCOUNT_ORDERS_REQUEST','ACCOUNT_CHECK_REQUEST','ACCOUNT_SETTLEMENT_REQUEST'].includes(message.type)||!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>(message.type==='ACCOUNT_SETTLEMENT_REQUEST'&&message.input?.action==='DOCUMENT_UPLOAD'?4250000:200000))return;
    const type=message.type==='ACCOUNT_ORDERS_REQUEST'?'ACCOUNT_ORDERS_RESULT':message.type==='ACCOUNT_SETTLEMENT_REQUEST'?'ACCOUNT_SETTLEMENT_RESULT':'ACCOUNT_CHECK_RESULT';
    try{
      const result=message.type==='ACCOUNT_ORDERS_REQUEST'?await getAccountPurchaseOrders(message.company):message.type==='ACCOUNT_SETTLEMENT_REQUEST'?await saveAccountSettlement(message.company,message.requestId,message.input):await saveAccountInvoiceCheck(message.company,message.requestId,message.input);
      room.postMessage({type,ok:true,company:message.company,requestId:message.requestId,result});
    }catch(error){room.postMessage({type,ok:false,company:message.company,requestId:message.requestId,error:error?.message||'Account request could not be confirmed.'});}
  });
  const maintenanceAction=String(wixLocationFrontend.query.accountIndexAction||'').toUpperCase(),maintenanceCompany=String(wixLocationFrontend.query.accountIndexCompany||'').toUpperCase(),maintenanceGeneration=String(wixLocationFrontend.query.accountIndexGeneration||'').toLowerCase();
  const maintenance=['PLAN','STAGE','ACTIVATE'].includes(maintenanceAction)&&['NCT','GHR'].includes(maintenanceCompany)?`&accountIndexAction=${maintenanceAction}&accountIndexCompany=${maintenanceCompany}${maintenanceAction==='ACTIVATE'&&/^[a-f0-9]{32}$/.test(maintenanceGeneration)?`&accountIndexGeneration=${maintenanceGeneration}`:''}`:'';
  room.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/account-room/?v=20261031-purchase-payment-message-v1'+maintenance;
});
