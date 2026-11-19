'use strict';
const assert=require('node:assert/strict');
const build='20261102-buyer-cbm-display-v1';
function apply(source){
 const once=(before,after)=>{assert.equal(source.split(before).length-1,1,before.slice(0,90));source=source.replace(before,after);};
 once('const num=v=>',`function lineCbm(qty,spec){if(typeof qty!=='number'||!Number.isFinite(qty)||qty<0)return null;if(qty===0)return 0;const value=spec===null||spec===undefined||String(spec).trim()===''?NaN:Number(spec);return Number.isFinite(value)&&value>0?qty*value:null;}
function totalCbm(rows,quantity,spec){let total=0;for(const row of rows){const value=lineCbm(quantity(row),spec(row));if(value===null)return null;total+=value;}return total;}
const cbmText=value=>value===null?'Incomplete':value.toFixed(4);
const num=v=>`);
 once('cbm=qty*num(x.cbmPerCtn)','cbm=lineCbm(qty,x.cbmPerCtn)');
 once('orderable&&qty>0&&cbm===0','orderable&&qty>0&&cbm===null');
 once('cbm=qty*num(line.cbmPerCtn)','cbm=lineCbm(qty,line.cbmPerCtn)');
 once("qty>0&&cbm.toFixed(4)==='0.0000'","cbm===null");
 once("committed===null&&!completed?'—':cbm.toFixed(4)","committed===null&&!completed?'—':cbmText(cbm)");
 once('committedCbm=rows.reduce((sum,row)=>sum+activeCommittedQty(row)*num(row.line.cbmPerCtn),0)','committedCbm=totalCbm(rows,trackingCommittedQty,row=>row.line.cbmPerCtn)');
 once('${committedCbm.toFixed(4)} m³',"${committedCbm===null?'Incomplete':cbmText(committedCbm)+' m³'}");
 once('cbm=ordered.reduce((s,x)=>s+num(x.orderQtyCtn)*num(x.cbmPerCtn),0)','cbm=totalCbm(ordered,x=>num(x.orderQtyCtn),x=>x.cbmPerCtn)');
 once("$('sumCbm').textContent=cbm.toFixed(4)","$('sumCbm').textContent=cbmText(cbm)");
 once('totalCbm=qty*num(item.cbmPerCtn),cbmDisplay=totalCbm===0','totalCbm=lineCbm(qty,item.cbmPerCtn),cbmDisplay=totalCbm===null');
 // Existing missing-data pill, with truthful text instead of an apparent measured zero.
 source=source.replaceAll('aria-description="CBM data is currently unavailable">0.0000</span>','aria-description="CBM data is currently unavailable">Missing</span>');
 return source.replace(/(<meta name="build-version" content=")[^"]+/,(_,prefix)=>prefix+build);
}
module.exports={apply,build};
