import { webMethod, Permissions } from 'wix-web-module';
import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import wixData from 'wix-data';
import { request as httpsRequest } from 'https';
import { getSecret } from 'wix-secrets-backend';

const ENDPOINT='https://script.google.com/macros/s/AKfycbzpMXT1ap2sOXRUkCAXx3BomPQK0E-0oTp6g3tna3Rs7cGHGRU0W2qRtwnU9YcC94qv/exec';
const SECRET='FMCG_QD_ROUTER_TOKEN', FX='WixFxRates';
const DEFAULTS=[{currency:'MYR',rateToMyr:1},{currency:'USD',rateToMyr:4},{currency:'SGD',rateToMyr:3.2}];

export const getFxRateSettings=webMethod(Permissions.SiteMember,async()=>{
  await requireAdmin();
  const found=await wixData.query(FX).limit(1000).find({suppressAuth:true,consistentRead:true});
  const active=found.items.filter(x=>x.active!==false);
  const meta=found.items.find(x=>upper(x.currency||x.title)==='MYR')||{};
  return {ok:true,rates:normalizeRates(active.length?active:DEFAULTS),lastSyncAt:meta.lastSyncedAt||null,lastSyncSummary:text(meta.lastSyncSummary)};
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
  const sharedSecret=await getSecret(SECRET);
  const response=await post({action:'SYNC_FX_RATES',sharedSecret,actorEmail:admin.email,rates});
  const body=JSON.parse(String(await response.text()).replace(/^\)\]\}'\s*/,''));
  if(!response.ok||!body.ok)throw new Error(body.error||'FX rates were saved, but QD synchronization failed.');
  const result=body.result||{}, summary=(Number(result.updated)||0)+' updated · '+(Number(result.skipped)||0)+' skipped · '+(Number(result.failed)||0)+' failed';
  const myr=await wixData.query(FX).eq('currency','MYR').limit(1).find({suppressAuth:true,consistentRead:true});
  if(myr.items[0])await wixData.update(FX,{...myr.items[0],lastSyncedAt:new Date(),lastSyncSummary:summary,updatedBy:admin.email},{suppressAuth:true});
  return {ok:true,rates,result,lastSyncAt:new Date()};
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
function post(payload){
  const send=(url,method,body)=>new Promise((resolve,reject)=>{const req=httpsRequest(url,{method,headers:{'Content-Type':'application/json'}},res=>{let data='';res.setEncoding('utf8');res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode||0,headers:res.headers||{},data}));});req.on('error',reject);if(body)req.write(body);req.end();});
  return send(ENDPOINT,'POST',JSON.stringify(payload)).then(async first=>{let current=first;if([301,302,303,307,308].includes(current.status)){const location=text(current.headers.location);if(!location)throw new Error('QD redirect location is missing.');current=await send(location,'GET','');}return {ok:current.status>=200&&current.status<300,text:async()=>current.data};});
}
function text(v){return String(v==null?'':v).trim()}function upper(v){return text(v).toUpperCase()}
