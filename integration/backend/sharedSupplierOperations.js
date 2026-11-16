import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
const text = value => String(value ?? '').trim();
const roles = ['Sales Representative','Sales Manager','Director','Account Dept.','Warehouse','Others'];
const fields = ['companyName','shortName','registrationNo','address','officeTel','email','companyWebsite','collectionAddress','paymentTerm','supplierStatus','notes','salesContacts','brands','bankName','bankAccountNo','registrationNoNew','tinNo','warehouseAddress','warehouseSameAsOffice'];
const optionalTextFields = ['bankName','bankAccountNo','registrationNoNew','tinNo','warehouseAddress'];
const version = row => operationId(fields.filter(key=>(key==='warehouseSameAsOffice'?row?.[key]===true:!optionalTextFields.includes(key)||text(row?.[key]))).map(key => [key,row?.[key] ?? null]));
const profileText = (key, value) => ['email','companyWebsite','bankAccountNo'].includes(key) ? text(value) : text(value).toUpperCase();
const comparableProfile = row => JSON.stringify(fields.map(key => {
  if (key==='warehouseSameAsOffice') return row[key]===true;
  if (key==='warehouseAddress' && row.warehouseSameAsOffice===true) return profileText(key,row.address);
  if (key==='salesContacts') return (row[key]||[]).map(contact => ['name','role','phone','email'].map(field=>profileText(field,contact[field]))).filter(contact=>contact.some(Boolean));
  if (key==='brands') return [...new Set((row[key]||[]).map(name=>text(name).toUpperCase()).filter(Boolean))].sort();
  return profileText(key,row[key]);
}));
function targetProfile(current, patch) {
  const target=Object.fromEntries(fields.map(key=>[key,key in patch?patch[key]:(current?.[key]??null)]));
  if(target.warehouseSameAsOffice===true) target.warehouseAddress=target.address || '';
  return target;
}
export function createSharedSupplierOperations({store, brandOptions, now = () => new Date()}) {
  const journal = createOperationJournal({store,now});
  async function profile(supplierId) {
    const row = await store.one('SharedSuppliers',{title:supplierId});
    if(!row) throw Error('Supplier not found.');
    const values = Object.fromEntries(fields.map(key=>[key,row[key] ?? (['salesContacts','brands'].includes(key)?[]:'')]));
    values.warehouseSameAsOffice = row.warehouseSameAsOffice===true;
    if(values.warehouseSameAsOffice) values.warehouseAddress=values.address;
    return {supplierId,version:version(row),...values};
  }
  async function save({requestId,staff,supplierId,expectedVersion,values}) {
    if(!values || Object.keys(values).some(key=>!fields.includes(key))) throw Error('Unsupported supplier field.');
    const patch = {};
    for(const key of fields) {
      if(!(key in values)) continue;
      if(['salesContacts','brands'].includes(key)) continue;
      if(key==='warehouseSameAsOffice') {
        if(typeof values[key]!=='boolean') throw Error('Invalid same-address choice.');
        patch[key]=values[key];
        continue;
      }
      if(typeof values[key] !== 'string' || values[key].length > 4000) throw Error('Invalid supplier field.');
      patch[key] = profileText(key, values[key]);
    }
    if(!patch.companyName) return {ok:false,requestId,error:'Company Name is required.'};
    if(patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) throw Error('Check supplier email.');
    if(patch.companyWebsite && !/^https?:\/\/[^\s]+$/i.test(patch.companyWebsite)) throw Error('Website must start with https:// or http://.');
    if(!Array.isArray(values.salesContacts) || values.salesContacts.length>200 || !Array.isArray(values.brands) || values.brands.length>1000) throw Error('Invalid contacts or brands.');
    patch.salesContacts = values.salesContacts.map(contact=>{
      if(!contact || Object.keys(contact).some(key=>!['name','role','phone','email'].includes(key))) throw Error('Invalid contact.');
      const item={name:text(contact.name).toUpperCase(),role:text(contact.role).toUpperCase(),phone:text(contact.phone).toUpperCase(),email:text(contact.email)};
      if(!item.name || (item.role && !roles.some(role=>role.toUpperCase()===item.role)) || Object.values(item).some(value=>value.length>500) ||
        (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email))) throw Error('Check contact Name, Role and Email.');
      return item;
    });
    patch.brands = [...new Set(values.brands.map(value=>text(value).toUpperCase()))].sort();
    if(patch.brands.some(value=>!value || value.length>200)) throw Error('Invalid brand name.');
    const identity = supplierId || 'SUP-'+operationId(requestId,staff.memberId).slice(0,16).toUpperCase();
    const collection='SharedSupplierActivity', scope='SUPPLIER/'+identity;
    if (supplierId && /^[a-f0-9-]{36}$/i.test(requestId || '') && staff?.memberId && staff.staffId && staff.staffName) {
      const current=await store.one('SharedSuppliers',{title:identity});
      if (current && version(current)===expectedVersion && comparableProfile(current)===comparableProfile(targetProfile(current,patch))) {
        const key=operationId(scope,requestId,staff.memberId);
        const [prepared,receipt,lock]=await Promise.all([store.read(collection,key),store.read(collection,operationId(key,'RESULT')),store.read(collection,operationId(scope,'LOCK'))]);
        if (!prepared && !receipt) {
          if (lock) throw Error('A save is still processing. Refresh before retrying the same save.');
          const latest=await store.read('SharedSuppliers',current._id);
          if (latest && version(latest)===expectedVersion && comparableProfile(latest)===comparableProfile(targetProfile(latest,patch))) {
            return {ok:true,unchanged:true,requestId,supplierId:identity,version:expectedVersion};
          }
        }
      }
    }
    return journal({collection,scope,entityId:identity,requestId,staff,input:{supplierId:identity,expectedVersion,patch},
      prepare:async()=>{
        const current=await store.one('SharedSuppliers',{title:identity});
        if(supplierId && !current) throw Error('Supplier not found.');
        if(current && version(current)!==expectedVersion) throw Error('Supplier changed. Reload before saving. Your input has been retained.');
        if(!supplierId && current) throw Error('Supplier identity already exists.');
        const newBrands=patch.brands.filter(brand=>!(current?.brands||[]).map(value=>text(value).toUpperCase()).includes(brand));
        if(newBrands.length) {
          const available=new Set((await brandOptions()).map(value=>text(value).toUpperCase()));
          if(newBrands.some(brand=>!available.has(brand))) throw Error('A selected brand is no longer in POINTBASE. Refresh brand options.');
        }
        const target=targetProfile(current,patch);
        if((text(target.bankName)||text(target.bankAccountNo))&&(!text(target.bankName)||!text(target.bankAccountNo))) throw Error('Enter both Bank Name and Account No.');
        if(text(target.bankName).length>160||text(target.bankAccountNo).length>64||/[\u0000-\u001f\u007f]/.test(text(target.bankName)+text(target.bankAccountNo))) throw Error('Check supplier bank details.');
        return {id:current?._id || operationId('SUPPLIER',identity),supplierId:identity,expected:current?version(current):null,patch:target,
          before:current?Object.fromEntries(fields.map(key=>[key,current[key]??null])):null,time:now().toISOString()};
      },
      apply:async plan=>{
        const current=await store.read('SharedSuppliers',plan.id), targetVersion=version(plan.patch);
        // If an earlier response was lost after the write, finish its receipt instead of duplicating it.
        if(!current || version(current)!==targetVersion) {
          if(plan.expected!==null && (!current || version(current)!==plan.expected)) throw Error('Supplier changed while this save was pending.');
          if(plan.expected===null && current) throw Error('Supplier identity already exists.');
          const record={...current,_id:plan.id,title:plan.supplierId,...plan.patch,updatedByStaffId:staff.staffId};
          if(current) await store.update('SharedSuppliers',record); else await store.insert('SharedSuppliers',record);
        }
        return {ok:true,requestId,supplierId:plan.supplierId,version:targetVersion,savedAt:plan.time};
      }
    });
  }
  return {profile,save};
}
