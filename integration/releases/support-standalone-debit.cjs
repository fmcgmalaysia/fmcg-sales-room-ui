const assert = require('node:assert/strict');

function replace(source, before, after) {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, () => after);
}

function supportScript(source) {
  source = replace(source, 'ctx.replacesDocumentId||\'\']);}', "ctx.replacesDocumentId||'',ctx.charge||false]);}");
  source = replace(source, "$('documents').classList.toggle('charge-form',charge);documentContext=", "$('documents').classList.toggle('charge-form',Boolean(charge));$('documents').classList.toggle('standalone-debit-form',charge==='STANDALONE_DN');documentContext=");
  source = replace(source, "window.SupportWorkroom.pendingDocumentAttempt(documentContext,data)", "window.SupportWorkroom.pendingDocumentAttempt({...documentContext,invoiceKind:charge==='STANDALONE_DN'?charge:undefined},data)");
  source = replace(source, "$('document-title').textContent='Charge Invoice';", "$('document-title').textContent=charge==='STANDALONE_DN'?'Debit Note':'Charge Invoice';");
  source = replace(source, "$('document-context').textContent=(customer?.name||customerId)+' · '+company;", `const identity=$('document-context');identity.textContent=(customer?.name||customerId)+' · '+company;
    if(charge==='STANDALONE_DN')identity.innerHTML='<strong>'+esc(customer?.name||customerId)+'</strong><small>'+esc(company)+'</small>';`);
  source = replace(source, "const choices=['Ocean Fee','Insurance','Sticker Printing','Labour Charges','Other'];", "const choices=charge==='STANDALONE_DN'?['On behalf of customer','Other']:['Ocean Fee','Insurance','Sticker Printing','Labour Charges','Other'];");
  source = replace(source, "const preferred=pendingInput?.chargeCurrency||customer?.currency||'';", `const preferred=pendingInput?.chargeCurrency||customer?.currency||'';
const reference=$('document-reference'),prefix=company+(charge==='STANDALONE_DN'?'-DN-':'-INV-');
reference.placeholder=prefix+'000000';reference.value=pendingInput?.reference||prefix;`);
  source = replace(source, "$('document-reference').readOnly=false;", "$('document-reference').readOnly=false;$('document-reference').placeholder='';");
  source = replace(source, "const named=label&&label!=='Other';", "const named=label&&label!=='Other'&&label!=='On behalf of customer';");
  source = replace(source, "description:label==='Other'?'':label", "description:['Other','On behalf of customer'].includes(label)?'':label");
  source = replace(source, "scope=ctx.charge?'INVOICE':ctx.customerScope?", "scope=ctx.charge==='STANDALONE_DN'?'CUSTOMER':ctx.charge?'INVOICE':ctx.customerScope?");
  source = replace(source, "{invoiceKind:'CHARGE',chargeCurrency:", "{invoiceKind:ctx.charge,chargeCurrency:");
  source = replace(source, "$('documents').close();if(company===saveCompany)await load([4]);", "$('documents').close();if(company===saveCompany)await load(ctx.charge==='STANDALONE_DN'?[0,4]:[4]);");
  source = replace(source, "if(button.dataset.newCharge)openDocument('SI',button.dataset.newCharge,'','',0,'',true);", `if(button.dataset.newCharge)info('Add document','<div class="charge-document-choice"><button type="button" class="primary" data-charge-choice="CHARGE" data-customer="'+esc(button.dataset.newCharge)+'">Invoice</button><button type="button" data-charge-choice="STANDALONE_DN" data-customer="'+esc(button.dataset.newCharge)+'">Debit Note</button></div>');
    if(button.dataset.chargeChoice){$('information').close();openDocument(button.dataset.chargeChoice==='STANDALONE_DN'?'DN':'SI',button.dataset.customer,'','',0,'',button.dataset.chargeChoice);}`);
  source = replace(source, "row.type==='SALES_INV'||row.type==='CHARGE_INV'", "row.type==='SALES_INV'||row.type==='CHARGE_INV'||row.invoiceKind==='STANDALONE_DN'");
  source = replace(source, "const charge=row.type==='CHARGE_INV',label=", "const debit=row.invoiceKind==='STANDALONE_DN',charge=row.type==='CHARGE_INV'||debit,label=");
  source = replace(source, "(charge?'Charge':'Goods')", "(debit?'Debit Note':charge?'Charge':'Goods')");
  source = replace(source, "if(code==='SI'&&/^[A-Za-z0-9_-]{10,200}$/.test(fileId))", "if(code===(row.invoiceKind==='STANDALONE_DN'?'DN':'SI')&&/^[A-Za-z0-9_-]{10,200}$/.test(fileId))");
  source = replace(source, "+'/view\">SI</a>';", "+'/view\">'+code+'</a>';");
  source = replace(source, "if(row.type==='CHARGE_INV'&&['$','CN','DN'].includes(code))", "if(row.type==='CHARGE_INV'&&['$','CN','DN'].includes(code)||row.type==='DEBIT_NOTE'&&!row.pending&&row.invoiceKind==='STANDALONE_DN'&&code==='$')");
  source = replace(source, "const charge=['CHARGE_INV','CHARGE_INVOICE_DOCUMENT'].includes(row.type);", "const debit=row.invoiceKind==='STANDALONE_DN',charge=debit||['CHARGE_INV','CHARGE_INVOICE_DOCUMENT'].includes(row.type);");
  source = replace(source, "const details=charge?chargeInvoiceDetails(row)", "const details=charge?(debit?'Debit Note · ':'')+chargeInvoiceDetails(row)");
  source = replace(source, "['CHARGE_INV','CHARGE_INVOICE_DOCUMENT'].includes(row.type));", "['CHARGE_INV','CHARGE_INVOICE_DOCUMENT'].includes(row.type)||row.invoiceKind==='STANDALONE_DN');");
  return replace(source, '>+ Add Invoice</button><ul', '>+ Add Invoice / Debit Note</button><ul');
}

function supportModel(source) {
  source = replace(source, "row.type==='CHARGE_INV'?{...row,...invoicePayment", "(row.type==='CHARGE_INV'||row.invoiceKind==='STANDALONE_DN')?{...row,...invoicePayment");
  return replace(source, "c.replacesDocumentId===(context.replacesDocumentId||'');", "c.replacesDocumentId===(context.replacesDocumentId||'')&&c.invoiceKind===context.invoiceKind;");
}

function financeScript(source) {
  const types = "['CUSTOMER_RECEIPT','SALES_CN','DEBIT_NOTE'].includes(row.type)";
  assert.equal(source.split(types).length, 3);
  source = source.replaceAll(types, types+"&&row.invoiceKind!=='STANDALONE_DN'");
  source = replace(source, ' function extraInputs(values){', ` const standaloneDebit=source=>source?.invoiceKind==='STANDALONE_DN';
 const hasChargeLines=source=>source?.type==='CHARGE_INV'||standaloneDebit(source);
 function extraInputs(values){`);
  source = replace(source, "+'<label class=\"account-field\"><span>Posting basis</span>", "+(standaloneDebit(source)?'':'<label class=\"account-field\"><span>Posting basis</span>");
  source = replace(source, ".join('')+'</select></label>';}", ".join('')+'</select></label>');}");
  source = replace(source, "if(source?.type==='CHARGE_INV')source.chargeLines", "if(hasChargeLines(source))source.chargeLines");
  source = replace(source, "return source?.type==='CHARGE_INV'?{chargeLines,existingDebitNoteId", "return standaloneDebit(source)?{chargeLines}:source?.type==='CHARGE_INV'?{chargeLines,existingDebitNoteId");
  source = replace(source, "source.type==='CHARGE_INV'?chargeFields(source,actual):matchingFields(source,actual)", "hasChargeLines(source)?chargeFields(source,actual):matchingFields(source,actual)");
  source = replace(source, "esc(actual.currency||'')", "esc(actual.currency||(standaloneDebit(source)?source.referenceCurrency:''))");
  source = replace(source, "if(source.type==='CHARGE_INV'){proofDialog.querySelector", "if(standaloneDebit(source)){for(const field of ['number','currency'])proofDialog.querySelector('[name='+field+']').readOnly=true;}\n  if(hasChargeLines(source)){proofDialog.querySelector");
  return source;
}

const css = `
#documents.standalone-debit-form #document-context{display:grid;gap:3px;margin:0 0 10px}
#documents.standalone-debit-form #document-context strong{font:700 17px/1.25 var(--master-font);color:#173651;overflow-wrap:anywhere}
#documents.standalone-debit-form #document-context small{font:500 11px/1.3 var(--master-font);color:#536d87}
`;

module.exports = { supportScript, supportModel, financeScript, css };
