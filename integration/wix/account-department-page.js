import { handleTaskChat } from 'public/taskChatBridge.js';
import { getCustomerFulfilment } from 'backend/customerFulfilment.web';
import { getStockExceptions, saveStockException, getDepartmentMessages, saveDepartmentMessage } from 'backend/stockExceptions.web';
import { getAccountPurchaseOrders, saveAccountInvoiceCheck, saveAccountSettlement } from 'backend/accountPurchase.web';
import { authentication } from 'wix-members-frontend';
// PO read and final-Invoice review; payment ledger and Warehouse closure remain unconnected.
$w.onReady(() => {
  const room=$w('#html1');
  room.onMessage(async event=>{
    const message=event.data||{};
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
    if(!['ACCOUNT_ORDERS_REQUEST','ACCOUNT_CHECK_REQUEST','ACCOUNT_SETTLEMENT_REQUEST'].includes(message.type)||!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>(message.type==='ACCOUNT_SETTLEMENT_REQUEST'&&message.input?.action==='DOCUMENT_UPLOAD'?4250000:200000))return;
    const type=message.type==='ACCOUNT_ORDERS_REQUEST'?'ACCOUNT_ORDERS_RESULT':message.type==='ACCOUNT_SETTLEMENT_REQUEST'?'ACCOUNT_SETTLEMENT_RESULT':'ACCOUNT_CHECK_RESULT';
    try{
      const result=message.type==='ACCOUNT_ORDERS_REQUEST'?await getAccountPurchaseOrders(message.company):message.type==='ACCOUNT_SETTLEMENT_REQUEST'?await saveAccountSettlement(message.company,message.requestId,message.input):await saveAccountInvoiceCheck(message.company,message.requestId,message.input);
      room.postMessage({type,ok:true,company:message.company,requestId:message.requestId,result});
    }catch(error){room.postMessage({type,ok:false,company:message.company,requestId:message.requestId,error:error?.message||'Account request could not be confirmed.'});}
  });
  room.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/account-room/?v=20261019-finance-audit-v6';
});
