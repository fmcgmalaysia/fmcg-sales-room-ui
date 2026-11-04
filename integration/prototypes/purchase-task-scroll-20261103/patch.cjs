const assert=require('node:assert/strict'),build='20261103-purchase-task-scroll-v1';
function once(s,a,b){assert.equal(s.split(a).length,2,a.slice(0,70));return s.replace(a,b);}
const capture=`    const viewportKey=company+'|'+activeCustomer,oldViewport=app.querySelector('.active-task-scroll');
    const viewport=view==='active'&&oldViewport?.dataset.taskViewport===viewportKey?{top:oldViewport.scrollTop,left:oldViewport.scrollLeft}:null;
`;
const restore=`    const nextViewport=app.querySelector('.active-order-table')?.closest('.tablewrap');
    if(view==='active'&&nextViewport){nextViewport.dataset.taskViewport=viewportKey;if(viewport)queueMicrotask(()=>{if(nextViewport.isConnected&&nextViewport.dataset.taskViewport===viewportKey){nextViewport.scrollTop=viewport.top;nextViewport.scrollLeft=viewport.left;}});}
`;
function patchApp(s){s=once(s,'  function render() {\n','  function render() {\n'+capture);return once(s,'    paintSaveTracker();if(view===\'dashboard\')',restore+'    paintSaveTracker();if(view===\'dashboard\')');}
function patchIndex(s){return s.replace(/app.js\?v=[^"&]+/,'app.js?v='+build).replace(/(<meta name="build" content=")[^"]+/,'$1'+build);}
module.exports={build,capture,restore,patchApp,patchIndex};
