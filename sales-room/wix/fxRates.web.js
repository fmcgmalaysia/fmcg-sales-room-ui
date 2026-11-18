import { webMethod, Permissions } from 'wix-web-module';
import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import wixData from 'wix-data';

const FX='WixFxRates';
const DEFAULTS=[{currency:'MYR',rateToMyr:1},{currency:'USD',rateToMyr:4},{currency:'SGD',rateToMyr:3.2}];

export const getFxRateSettings=webMethod(Permissions.SiteMember,async()=>{
  await requireAdmin();
  const found=await wixData.query(FX).limit(1000).find({suppressAuth:true,consistentRead:true});
  const active=found.items.filter(x=>x.active!==false);
  const meta=found.items.find(x=>upper(x.currency||x.title)==='MYR')||{};
  return {ok:true,rates:normalizeRates(active.length?active:DEFAULTS),lastSyncAt:meta.rateUpdatedAt||null};
});

export const saveAndSyncFxRates=webMethod(Permissions.SiteMember,async(rawRates)=>{
  const admin=await requireAdmin(), rates=normalizeRates(rawRates), now=new Date();
  const found=await wixData.query(FX).limit(1000).find({suppressAuth:true,consistentRead:true});
  const byCode=new Map(found.items.map(x=>[upper(x.currency||x.title),x]));
  const active=new Set(rates.map(x=>x.currency));
  for(const rate of rates){
    const old=byCode.get(rate.currency), row={...(old||{}),title:rate.currency,currency:rate.currency,rateToMyr:rate.rateToMyr,active:true,updatedBy:admin.email,rateUpdatedAt:now};
    if(old&&old._id) await wixData.update(FX,row,{suppressAuth:true}); else await wixData.insert(FX,row,{suppressAuth:true});
  }
  for(const old of found.items){const code=upper(old.currency||old.title);if(code&&!active.has(code))await wixData.update(FX,{...old,active:false,updatedBy:admin.email,rateUpdatedAt:now},{suppressAuth:true});}
  return {ok:true,rates,lastSyncAt:now};
});

async function requireAdmin(){
  const staff=await getCurrentStaffContext();
  if(staff?.authorized!==true||staff.role!=='SUPER ADMIN'||!staff.loginEmail)throw new Error('FX Rate Settings require LTPOS Super Admin access.');
  return {email:staff.loginEmail,role:staff.role};
}
function normalizeRates(input){
  const map=new Map();for(const item of Array.isArray(input)?input:[]){const currency=upper(item&&(item.currency||item.title)),rate=currency==='MYR'?1:Number(item&&item.rateToMyr);if(!/^[A-Z]{3}$/.test(currency))throw new Error('Every FX entry requires a three-letter currency code.');if(!Number.isFinite(rate)||rate<=0)throw new Error(currency+' requires a rate above 0.00.');map.set(currency,{currency,rateToMyr:Math.round(rate*1000000)/1000000});}
  if(!map.size)throw new Error('At least one FX rate is required.');map.set('MYR',{currency:'MYR',rateToMyr:1});return [...map.values()].sort((a,b)=>a.currency==='MYR'?-1:b.currency==='MYR'?1:a.currency.localeCompare(b.currency));
}
function upper(v){return String(v??'').trim().toUpperCase()}
