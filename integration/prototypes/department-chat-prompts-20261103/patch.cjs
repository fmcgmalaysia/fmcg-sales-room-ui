const assert=require('node:assert/strict'),build='20261103-department-chat-prompts-v1';
const presets=`function presets(){
 if(department==='ACCOUNT')return ['Please upload the supplier invoice for review.','Please confirm the supplier bank account details.','Please check the remaining PO balance and all linked payment slips.','This payment request is under review.'];
 if(current?.peer==='SALES'){
  if(department==='PURCHASE')return ['We are still sourcing these goods. Please confirm the customer deadline. 正在找货，请确认客户截止日期。','Please confirm whether the customer can wait or split the remaining quantity. 请确认客户能否等待或分批接收余量。'];
  return ['Please confirm the customer shipment instructions. 请确认客户发货指示。','Please review the remaining quantity with the customer. 请与客户核对剩余数量。'];
 }
 if(department==='PURCHASE'&&current?.peer==='ACCOUNT')return ['Please confirm the expected payment date. 请确认预计付款日期。','Please review the supplier documents and current PO amount. 请核对供应商文件及当前采购金额。','Please check both payment slips against the full PO balance. 请按整张采购单余额核对两次付款凭证。'];
 if(department==='PURCHASE'&&current?.peer==='WAREHOUSE')return ['Please confirm the actual received quantity and condition. 请确认实收数量及货物情况。','Please retain the outstanding quantity until supplier instructions are confirmed. 请保留待收余量，等待确认供应商指示。','Please attach photos of damaged or incorrect goods. 请附上坏货或错货照片。'];
 if(department==='WAREHOUSE'&&current?.peer==='SUPPORT')return ['Loaded is below Alloc. Please advise how to handle the remaining cartons. 实装少于分配，请指示如何处理剩余箱数。','Current usable stock cannot fulfil this Desk. Please ask Purchase to reallocate. 现有可用货不足以完成本工作台，请采购重新分配。','Please confirm ETD and Last Gate In. 请确认预计离港及最后进场时间。'];
 if(department==='WAREHOUSE')return ['Received quantity differs from the PO. Please confirm whether to wait for delivery or reallocate. 实收与采购单不符，请确认等待补货或重新分配。','These goods require isolation. Please review the Stock Issue. 货物需要隔离，请查看库存异常。','Please confirm the supplier replacement or return instructions. 请确认供应商补货或退货指示。'];
 if(department==='SUPPORT'&&current?.peer==='ACCOUNT')return ['Please review the customer proof and post the confirmed receipt. 请审核客户凭证，并登记确认后的收款。','Please confirm the invoice balance before releasing the customer statement. 请核对发票余额后提供客户对账单。'];
 if(department==='SUPPORT')return ['Please confirm actual Loaded for this Desk before invoicing. 请在开票前确认本工作台实装数量。','Keep the remaining cartons pending Support instructions. 请保留剩余箱数，等待客服指示。','Please provide photos for damaged or missing goods. 请提供损坏或缺货照片。'];
 return ['Please check this task and advise the next action. 请核对本任务并回复下一步处理。'];
}`;
function patchChat(s){const start=s.indexOf('function presets(){'),end=s.indexOf('\nfunction ',start+12);assert(start>=0&&end>start);return s.slice(0,start)+presets+s.slice(end);}
function patchHost(s){const re=/task-chat.js\?v=[^"&]+/;assert(re.test(s));return s.replace(re,'task-chat.js?v='+build);}
module.exports={build,presets,patchChat,patchHost};
