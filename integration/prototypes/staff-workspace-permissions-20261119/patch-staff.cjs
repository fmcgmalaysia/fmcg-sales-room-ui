const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const BUILD='20261119-staff-workspace-permissions-v1';
function patchStaff(source){
  source=source.replace(/\r\n/g,'\n');
  assert.equal(createHash('sha256').update(source).digest('hex'),'d2dc2b02db87103cccdc13ea614a29166f20c5c77c756692d54bc4290a1fb37b');
  const replace=(before,after)=>{assert.equal(source.split(before).length,2,before.slice(0,100));source=source.replace(before,()=>after);};
  replace('20261119-staff-custom-domain-v1',BUILD);
  replace('</style><link',`.permission-help{margin:6px 0;color:#526b82;font-size:12px}.permission-summary{display:block;padding:10px;background:#edf4fb;border-radius:5px;font-size:13px;white-space:pre-line}.permission-card{margin-top:10px;border:1px solid #c7d7e6;border-radius:6px;padding:10px}.permission-card>summary{font-size:14px;font-weight:650}.permission-card[open]>summary{margin-bottom:10px}.permission-card .scope-grid{row-gap:12px}input[type=checkbox]{width:16px;height:16px;flex:none}.permission-customer-scope[hidden]{display:none}\n</style><link`);
  replace('Set access now (optional)','Workspace permissions 工作间权限');
  replace('<legend>Department access 部门权限</legend>','<legend>Internal departments 内部部门</legend>');
  const start=source.indexOf('      <fieldset>\n        <legend>Sales Room</legend>');
  const end=source.indexOf('      </details>',start);
  assert(start>0&&end>start);
  source=source.slice(0,start)+`      <p class="permission-help">Warehouse permissions use company scope and warehouse tasks. They do not grant customer pages.</p>
      <details class="permission-card" open><summary>Sales Room · Customer work 客户工作</summary>
        <label class="check"><input type="checkbox" name="customerWorkEnabled">Allow Sales Room entry 允许进入</label>
        <div class="scope-grid">
          <label>Customer scope 客户范围<select name="customerWorkScope"><option value="SELECTED">Selected customers 指定客户</option><option value="ALL">All customers 全部客户</option></select></label>
          <label>Catalogue<select name="catalogueAccess"><option value="">No access</option><option value="VIEW">View products</option><option value="SELECT">View and select products</option></select></label>
          <label>Buyer Room<select name="buyerRoomAccess"><option value="">No access</option><option value="VIEW">View only</option><option value="REQUEST">View and send requests</option></select></label>
          <div><label class="check"><input type="checkbox" name="createCustomers">Register customers 注册客户</label><label class="check"><input type="checkbox" name="editProfiles">Edit customer details 编辑资料</label><label class="check"><input type="checkbox" name="submitOrders">Submit orders to NCT or GHR 提交订单</label></div>
        </div>
        <p class="permission-help">Turning off Sales Room entry also blocks its customer pages and selection actions. Other departments stay separate.</p>
      </details>
      <details class="permission-card" open><summary>Sales Management 销售管理</summary>
        <label class="check"><input type="checkbox" name="performanceAccess">Sales Performance · includes Quotations 业绩及报价</label>
        <label class="check"><input type="checkbox" name="quotationAccess">Catch Cost, edit and publish quotations</label>
        <p class="permission-help">Performance access includes quotation access. Quotation-only access does not grant performance. Quotations show current assigned customers; performance follows authoritative historical transaction ownership. Super Admin can view all.</p>
      </details>
      <fieldset id="customer-scope-options" class="permission-customer-scope"><legend>Selected customers 指定客户</legend>
        <p>View permits browsing; Edit permits the customer actions enabled above. Support department scope also uses these grants. Warehouse does not.</p>
        <div id="customer-options"></div><output id="customer-status" aria-live="polite"></output>
      </fieldset>
      <output id="permission-summary" class="permission-summary" aria-live="polite"></output>
`+source.slice(end);
  replace("['ACCOUNT', 'Finance'], ['SALES MANAGEMENT', 'Sales Management']","['ACCOUNT', 'Finance'], ['STOCK CONTROL', 'Stock Control']");
  replace("    select.add(new Option('Edit', 'EDIT'));","    if (department !== 'STOCK CONTROL') select.add(new Option('Edit', 'EDIT'));");
  replace("        departmentAccess: Object.fromEntries(departments.map(([department]) =>\n          [department, data.get(department)]).filter(([, level]) => level)),",`        departmentAccess: {...(editing?.access?.departmentAccess?.['SALES MANAGEMENT']?{'SALES MANAGEMENT':editing.access.departmentAccess['SALES MANAGEMENT']} : {}), ...Object.fromEntries(departments.map(([department]) => [department,data.get(department)]).filter(([,level])=>level))},`);
  replace("        salesRoom: data.get('salesRoom'),\n        salesFunction: data.get('salesFunction'),",`        salesRoom: editing?.access?.salesRoom ?? '',
        salesFunction: editing?.access?.salesFunction ?? '',
        customerWork: {
          enabled: data.has('customerWorkEnabled'), scope: data.get('customerWorkScope'),
          createCustomers: data.has('createCustomers'), editProfiles: data.has('editProfiles'),
          catalogue: data.get('catalogueAccess'), buyerRoom: data.get('buyerRoomAccess'), submitOrders: data.has('submitOrders')
        },
        quotationAccess: form.elements.namedItem('quotationAccess').disabled ? (form.elements.namedItem('quotationAccess').dataset.standalone==='true'?'EDIT':'') : data.has('quotationAccess') ? 'EDIT' : '',
        performanceAccess: data.has('performanceAccess') ? 'VIEW' : '',`);
  replace("Boolean(access.supportViewAll), access.salesRoom || '', access.salesFunction || '']);",`Boolean(access.supportViewAll), access.salesRoom || '', access.salesFunction || '',
      effectiveWork(access), effectiveQuotation(access), access.performanceAccess || '']);`);
  replace('  function refreshEmployeeSave() {',`  function effectiveWork(access = {}) {
    const work=access.customerWork;
    return work ? {enabled:work.enabled,scope:work.scope,createCustomers:work.createCustomers,editProfiles:work.editProfiles,catalogue:work.catalogue,buyerRoom:work.buyerRoom,submitOrders:work.submitOrders} : {
      enabled:Boolean(access.salesRoom),scope:'SELECTED',createCustomers:access.salesRoom==='EDIT'&&access.salesFunction==='SALES',editProfiles:access.salesRoom==='EDIT'&&access.salesFunction==='SALES',catalogue:access.salesRoom==='EDIT'?'SELECT':access.salesRoom?'VIEW':'',buyerRoom:access.salesRoom==='EDIT'?'REQUEST':access.salesRoom?'VIEW':'',submitOrders:access.salesRoom==='EDIT'
    };
  }
  function effectiveQuotation(access = {}) { return access.quotationAccess ?? (access.salesFunction==='SALES'&&access.departmentAccess?.['SALES MANAGEMENT']==='EDIT'?'EDIT':''); }
  function renderPermissionSummary() {
    const performance=form.elements.namedItem('performanceAccess').checked, quote=form.elements.namedItem('quotationAccess');
    if(performance){if(quote.dataset.standalone===undefined)quote.dataset.standalone=String(quote.checked);quote.checked=true;quote.disabled=true;}
    else if(quote.dataset.standalone!==undefined){quote.disabled=false;quote.checked=quote.dataset.standalone==='true';delete quote.dataset.standalone;}
    const {access}=registration(), work=access.customerWork;
    const scope=work.scope==='ALL'?'all customers':'selected customers';
    id('customer-scope-options').hidden=!(work.enabled&&work.scope==='SELECTED')&&!access.departmentAccess.SUPPORT;
    id('permission-summary').textContent=(work.enabled ? 'Sales Room: '+scope+'\\nCatalogue: '+(work.catalogue||'no access')+' · Buyer Room: '+(work.buyerRoom||'no access') : 'Customer work: no access')+
      '\\nQuotations: '+(access.quotationAccess||access.performanceAccess?'own assigned customers':'no access')+
      '\\nSales Performance: '+(access.performanceAccess?'own historically attributed transactions':'no access')+
      '\\nWarehouse never grants access to customer pages.';
  }
  function refreshEmployeeSave() {
    renderPermissionSummary();`);
  replace("    form.elements.namedItem('salesRoom').value=access.salesRoom ?? '';\n    form.elements.namedItem('salesFunction').value=access.salesFunction ?? '';",`    const work=effectiveWork(access);
    form.elements.namedItem('customerWorkEnabled').checked=work.enabled;
    form.elements.namedItem('customerWorkScope').value=work.scope;
    for(const key of ['createCustomers','editProfiles','submitOrders'])form.elements.namedItem(key).checked=work[key];
    form.elements.namedItem('catalogueAccess').value=work.catalogue;
    form.elements.namedItem('buyerRoomAccess').value=work.buyerRoom;
    form.elements.namedItem('quotationAccess').disabled=false;
    form.elements.namedItem('quotationAccess').checked=Boolean(effectiveQuotation(access));
    delete form.elements.namedItem('quotationAccess').dataset.standalone;
    form.elements.namedItem('performanceAccess').checked=access.performanceAccess==='VIEW';
    renderPermissionSummary();`);
  replace("employee.status === 'PENDING' ? 'Pending verification' : employee.status;", "employee.status === 'PENDING' ? 'Pending verification' : employee.status + (employee.linked ? '' : ' · First sign-in pending');");
  return source;
}
module.exports={patchStaff,BUILD};
if(require.main===module){const fs=require('node:fs');fs.writeFileSync(process.argv[2],patchStaff(fs.readFileSync(__dirname+'/staff.baseline.html','utf8')));}
