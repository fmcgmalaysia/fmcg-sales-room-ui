const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),evidence='C:/FMCG-WIX-LOCAL/handoff/staff-workspace-permissions-20261119';
const normalized=s=>s.replace(/\r\n/g,'\n');
function prepare(name,target,edit){let source=normalized(fs.readFileSync(path.join(evidence,'live',name),'utf8'));
  const replace=(old,next)=>{assert.equal(source.split(old).length,2,name+': '+old.slice(0,80));source=source.replace(old,()=>next);};
  edit(replace,()=>source);fs.writeFileSync(path.join(root,target),source.trimEnd()+'\n');
}
prepare('sales-page.js','sales-room/wix/sales-room-page.js',replace=>{
  replace('20261118-sales-qd-retirement-v1','20261119-staff-workspace-permissions-v1');
  replace("  staffPromise.then((staff) => {\n    if (!staff.authorized) {\n      wixLocationFrontend.to(STAFF_LOGIN_URL);\n    }\n  });",`  function showStaffAccessIssue(staff) {
    if (!authentication.loggedIn()) { wixLocationFrontend.to(STAFF_LOGIN_URL); return; }
    const message=staff?.reason==='MASTER_STAFF_ACCESS_UNAVAILABLE'?'Staff access is temporarily unavailable. The system will check again.':'Staff Management does not allow this customer work. Contact your administrator.';
    salesRoom.postMessage({type:'SALES_ROOM_CUSTOMERS',ok:false,error:message});
  }
  staffPromise.then(staff => { if (!staff.authorized) showStaffAccessIssue(staff); });`);
  replace("      const staff = await staffPromise;\n      const customerId = String(message.customerId || '').trim();\n      if (!staff.authorized || !/^CUS-[A-Za-z0-9-]+$/.test(customerId)) return;",`      const staff = await loadCurrentStaff();
      const customerId = String(message.customerId || '').trim();
      if (!staff.authorized) { showStaffAccessIssue(staff); return; }
      if (!/^CUS-[A-Za-z0-9-]+$/.test(customerId)) return;
      const can=action=>staff.customerScope?.allCustomers===true || staff.customerScope?.allCustomerActions?.includes(action) || staff.customerScope?.customerActions?.[action]?.includes(customerId);
      if (!can('BUYER_ROOM_VIEW')) {
        if (can('CATALOGUE_VIEW')) wixLocationFrontend.to('/catalogue?assist='+encodeURIComponent(customerId));
        else showStaffAccessIssue({reason:'CUSTOMER_ACTION_DENIED'});
        return;
      }`);
  replace('            canViewAllCustomers: staff.canViewAllCustomers','            canViewAllCustomers: staff.canViewAllCustomers,\n            canBrowseAllCustomers: staff.canBrowseAllCustomers');
});
prepare('buyer-page.js','buyer-room/wix/buyer-room-page.js',replace=>{
  replace("import { session } from 'wix-storage-frontend';","import { session } from 'wix-storage-frontend';\nimport { authentication } from 'wix-members-frontend';");
  replace("        frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ok: false, message: 'Assisted Access Error: ' + (error?.message || String(error)) });",`        if (!authentication.loggedIn()) { wixLocationFrontend.to('/sales-room-login?next='+encodeURIComponent('/buyer-room?assist='+assistCustomerId)); return; }
        frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ok: false, message: 'Staff Management could not authorize this Buyer Room. ' + (error?.message || String(error)) });`);
});
prepare('catalogue-page.js','buyer-room/catalogue/wix/catalogue-page-v3.js',replace=>{
  replace('async function loadSelectionState(assistCustomerId = \'\') {',`let catalogueAccessIssue = false;
function reportCatalogueAccess(message, blocked = true) {
    catalogueAccessIssue = blocked;
    try { $w('#text19').text=message?'Access unavailable':String(catalogueContextMessage?.sheetName||'Catalogue'); } catch (_) {}
    try { $w('#text20').text=message||String(catalogueContextMessage?.signedInName||''); } catch (_) {}
    try { if(blocked)$w('#html5').collapse();else $w('#html5').expand(); } catch (_) {}
}
async function loadSelectionState(assistCustomerId = '') {`);
  replace('    const state = await getCatalogueSelectionState(assistCustomerId);\n    sidebarSelectionState(state);','    const state = await getCatalogueSelectionState(assistCustomerId);\n    sidebarSelectionState(state);\n    if(state?.ok) reportCatalogueAccess(\'\', false);');
  replace('    if (staff?.authorized) {',`    if (staff?.authorized) {
        if (staff.customerScope?.pages && !staff.customerScope.pages.includes('CATALOGUE')) { reportCatalogueAccess('Staff Management does not allow Catalogue access.'); return; }`);
  replace("                wixLocationFrontend.to('/blank-1');", "                if (!authentication.loggedIn()) wixLocationFrontend.to('/sales-room-login?next='+encodeURIComponent('/catalogue?assist='+assistCustomerId));\n                else reportCatalogueAccess('Staff Management could not authorize this customer Catalogue.');");
  replace("    if (!hasBuyerAccess && wixWindowFrontend.viewMode === 'Site') { wixLocationFrontend.to('/'); return; }", "    if (!hasBuyerAccess && wixWindowFrontend.viewMode === 'Site') { if(authentication.loggedIn()) reportCatalogueAccess('This account has no customer Catalogue access. Contact your administrator.'); else wixLocationFrontend.to(assistCustomerId?'/sales-room-login?next='+encodeURIComponent('/catalogue?assist='+assistCustomerId):'/'); return; }");
  replace("            selectionContext = null;\n            selectedProductIds = new Set();",`            if (expiredAssistCustomerId) {
                if(!authentication.loggedIn())wixLocationFrontend.to('/sales-room-login?next='+encodeURIComponent('/catalogue?assist='+expiredAssistCustomerId));
                else { const denied=/permission|not authorized|authorization is required|suspended|not found|not ready/i.test(error?.message||''); reportCatalogueAccess(denied?'Staff Management does not allow this customer Catalogue.':'Access is temporarily unavailable. The system is checking again.',denied); }
                return;
            }
            selectionContext = null;
            selectedProductIds = new Set();`);
  replace('function openBuyerRoom() {','function openBuyerRoom() {\n    if(catalogueAccessIssue)return;');
});
const loginOriginal=normalized(fs.readFileSync('C:/FMCG-WIX-LOCAL/handoff/staff-sales-access-20261119/sales-login-page.live.js','utf8'));
fs.writeFileSync(path.join(evidence,'live/sales-login-page.js'),loginOriginal);
prepare('sales-login-page.js','integration/wix/sales-room-login-page.js',replace=>{
  replace("const READY_LABEL = 'Continue with Google';",`const READY_LABEL = 'Continue with Google';
const TARGET_KEY = 'staffWorkspaceReturnTarget';
function validStaffTarget(value) {
  try {
    const url=new URL(value,SITE_BASE);
    if(url.origin!==SITE_BASE || !['/sales-room','/catalogue','/buyer-room'].includes(url.pathname))return '';
    if(url.pathname==='/sales-room')return '/sales-room';
    const id=url.searchParams.get('assist')||'';
    return /^CUS-[A-Za-z0-9-]+$/.test(id)?url.pathname+'?assist='+encodeURIComponent(id):'';
  } catch (_) { return ''; }
}
function staffReturnTarget() {
  let saved;try{saved=JSON.parse(session.getItem(TARGET_KEY)||'null');session.removeItem(TARGET_KEY);}catch(_){}
  return saved?.expiresAt>Date.now()?validStaffTarget(saved.target)||SALES_ROOM_URL:SALES_ROOM_URL;
}`);
  replace('      wixLocationFrontend.to(SALES_ROOM_URL);','      wixLocationFrontend.to(staffReturnTarget());');
  replace("$w.onReady(async function () {",`$w.onReady(async function () {
  const requested=validStaffTarget(wixLocationFrontend.query?.next||'');
  if(requested)session.setItem(TARGET_KEY,JSON.stringify({target:requested,expiresAt:Date.now()+10*60*1000}));`);
  replace('  await handleGoogleReturn();','  const handled=await handleGoogleReturn();\n  if(!handled && authentication.loggedIn())await verifyStaffAndEnter();');
});
console.log('Prepared four minimal entry patches from captured formal pages');
