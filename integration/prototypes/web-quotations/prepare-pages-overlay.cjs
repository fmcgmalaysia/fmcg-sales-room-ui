const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildWixWorkroom } = require('./build-wix-workroom.cjs');

const expectedSales = '1e6133cda9086aa28fb8117034b948ddfb1548d9ff278956cf4370dda57fb6d2';
const build = '20261117-sales-web-quotation-v1';

function patchSales(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw Error(`Review the Sales Room base around ${before.slice(0, 80)}`);
    source = source.replace(before, () => after);
  };
  source = `<!-- Sales Room web quotation build ${build} -->\n<style>#webQuoteAssignee[hidden],.application-flow-panel[hidden]{display:none!important}</style>\n` + source;
  replace('<select id="assignedStaffSelect" name="assignedStaffId" required disabled>', '<select id="assignedStaffSelect" name="assignedStaffId" disabled>');
  replace('<div class="field full"><label>Assigned Salesperson', '<div class="field full" id="webQuoteAssignee" hidden><label>Assigned Salesperson');
  replace('const assignedSelect=document.getElementById', 'let quotationSetup=null;\nconst assignedSelect=document.getElementById');
  const from = source.indexOf('function applyAssignmentAccess()');
  const end = source.indexOf("assignedSelect.addEventListener('change'", from);
  if (from < 0 || end < 0) throw Error('Sales Room ownership form changed.');
  source = source.slice(0, from) + `function webRegistration(){return quotationSetup?.quotationMode==='WEB'}
function creationLabel(){return webRegistration()?'Create Customer':'Create Customer & QD'}
function applyAssignmentAccess(){
  const field=document.getElementById('webQuoteAssignee');
  const mayAssign=Boolean(quotationSetup?.canCreate && quotationSetup.mayAssignOthers && assignableStaff.length);
  field.hidden=!mayAssign;assignedSelect.disabled=!mayAssign;assignedSelect.required=mayAssign;
  if(mayAssign&&assignableStaff.length===1)assignedSelect.value=assignableStaff[0].staffId;
  updateAssignedQdHint();
  if(webRegistration())assignedQdHint.textContent='Customer access is confirmed through LTPOS.';
  const button=document.getElementById('createBtn');if(!submitting)button.textContent=creationLabel();
  const flow=document.querySelector('.application-flow-panel');if(flow)flow.hidden=webRegistration();
}
function renderAssignableStaff(payload){
  quotationSetup=payload.ok?payload:null;
  assignableStaff=Array.isArray(payload.staff)?payload.staff:[];
  assignedSelect.innerHTML='<option value="">Select salesperson</option>';
  assignableStaff.forEach(item=>{const option=document.createElement('option');option.value=item.staffId;option.textContent=item.staffName;assignedSelect.appendChild(option)});
  applyAssignmentAccess();
}
` + source.slice(end);
  replace("if(!selected){status('Please select a valid salesperson.','err');return}const d=Object.fromEntries(new FormData(form).entries());d.assignedStaffId=selected.staffId;", "if(!quotationSetup?.canCreate){status('Customer creation access could not be confirmed.','err');return}if(quotationSetup.mayAssignOthers&&!selected){status('Please select a valid salesperson.','err');return}const d=Object.fromEntries(new FormData(form).entries());if(quotationSetup.mayAssignOthers)d.assignedStaffId=selected.staffId;");
  source = source.replaceAll("createBtn.textContent='Create Customer & QD'", 'createBtn.textContent=creationLabel()');
  replace("status('Creating Customer ID and copying the complete Quotation Desk template. Please do not submit again.','wait')", "status(webRegistration()?'Creating the customer and confirming LTPOS access…':'Creating Customer ID and copying the complete Quotation Desk template. Please do not submit again.','wait')");
  replace("(ready?'QD Ready · Customer Access Active':'Next Step: Open QD, complete Allow Access, then Verify & Activate.')", "(result.quotationMode==='WEB'?'Web Quotations Ready · Customer Access Active':ready?'QD Ready · Customer Access Active':'Next Step: Open QD, complete Allow Access, then Verify & Activate.')");
  replace('if(found)completeCustomerCreation(found)', "if(found&&(found.quotationMode!=='WEB'||found.webQuotationStatus==='READY'))completeCustomerCreation(found)");
  replace("if(m.ok)renderAssignableStaff(m);\n    else{", "renderAssignableStaff(m);\n    if(!m.ok){");
  replace("function customerAccessLabel(c){", "function customerAccessLabel(c){if(c.quotationMode==='WEB')return c.webQuotationStatus==='READY'?customerAccessState(c):'Awaiting LTPOS access';");
  return source;
}

function prepareSalesQuotationOverlay(salesBefore, destination) {
  const original = fs.readFileSync(salesBefore);
  if (createHash('sha256').update(original).digest('hex') !== expectedSales) throw Error('Sales Room source does not match the verified Pages release.');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'index.html'), patchSales(original.toString('utf8').replace(/\r\n/g, '\n')));
  buildWixWorkroom(path.join(destination, 'master-quotations'));
}

if (require.main === module) {
  const [before, destination] = process.argv.slice(2);
  if (!before || !destination) throw Error('Pass the verified Sales Room HTML and an overlay output directory.');
  prepareSalesQuotationOverlay(before, destination);
}

module.exports = { patchSales, prepareSalesQuotationOverlay };
