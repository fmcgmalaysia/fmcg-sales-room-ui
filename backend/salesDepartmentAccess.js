const text=value=>String(value??'').trim();
export const SALES_CUSTOMER_TERMS=Object.freeze(['30% + 70%','Cash','7 days','14 days','30 days']);
export const salesCustomerTerm=value=>SALES_CUSTOMER_TERMS.find(term=>term.replace(/\s/g,'').toUpperCase()===text(value).replace(/\s/g,'').toUpperCase())||null;
export function createSalesDepartmentReader({authorize,readAssignedCustomers,readCompany}){
 return async()=>{
  const staff=await authorize();
  if(staff?.authorized!==true||!text(staff.staffId)||!text(staff.staffName)){const error=Error('An authorized Sales Room staff account is required.');error.code='SALES_ACCESS_DENIED';throw error;}
  const staffId=text(staff.staffId).toUpperCase(),rows=await readAssignedCustomers(staffId);
  if(!Array.isArray(rows)||rows.length>200||rows.some(row=>text(row.assignedStaffId).toUpperCase()!==staffId||!text(row.customerId))||new Set(rows.map(row=>text(row.customerId))).size!==rows.length)throw Error('Assigned customer identities require review.');
  const customers=rows.map(row=>({id:text(row.customerId),name:text(row.title),assignedStaffId:staffId,country:text(row.country),currency:text(row.preferredCurrency),term:salesCustomerTerm(row.paymentTerm),address1:text(row.address1),address2:text(row.address2),address3:text(row.address3),contact:[row.picTitle,row.picName].map(text).filter(Boolean).join(' '),email:text(row.primaryEmail),phone:text(row.mobileNo)}));
  if(customers.some(row=>!row.name))throw Error('Customer profile is incomplete.');
  const ids=customers.map(row=>row.id),companies=await Promise.all(['NCT','GHR'].map(company=>ids.length?readCompany({company,staff:{staffId,staffName:staff.staffName},customerIds:ids}):Promise.resolve({company,invoices:[],balances:[]})));
  for(let index=0;index<companies.length;index++){const result=companies[index];if(result?.company!==['NCT','GHR'][index]||!Array.isArray(result.invoices)||!Array.isArray(result.balances)||[...result.invoices,...result.balances].some(row=>row.company!==result.company||!ids.includes(row.customerId)))throw Error('Sales account records could not be confirmed.');}
  return {staffId,staffName:staff.staffName,customers,companies};
 };
}
