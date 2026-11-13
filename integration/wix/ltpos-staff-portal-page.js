import { authentication } from 'wix-members-frontend';
import { getLtposWorkspaces } from 'backend/ltposWorkspaces.web';

const FRAME = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/ltpos/?v=ltpos-staff-portal-v2';
const SITE = 'https://fmcg999.wixstudio.com/master';
const workspaces = new Map([
  ['purchase', ['Purchase 采购', SITE]],
  ['support', ['Support 后勤', SITE + '/support-department']],
  ['warehouse', ['Warehouse 货仓', SITE + '/warehouse-department']],
  ['finance', ['Finance 财务', SITE + '/account-department']],
  ['staff-management', ['Staff Management 员工管理', SITE + '/staff-management']],
  ['sales-room', ['Sales Room 销售工作室', 'https://www.fmcgmalaysia.com/sales-room']]
]);

$w.onReady(() => {
  const frame = $w('#html1');
  const workspaceSection = $w('#section5');
  const links = $w('#text5');
  links.customClassList.add('ltpos-workspace-links');
  let busy = false;
  const send = (state, details = {}) => frame.postMessage({ type: 'LTPOS_SESSION', state, ...details });
  function clearLinks() {
    links.html = '<p>&nbsp;</p>';
    return workspaceSection.collapse();
  }
  async function renderLinks(ids) {
    const authorized = [...workspaces].filter(([id]) => ids.includes(id));
    if (!authorized.length) { await clearLinks(); return false; }
    const anchors = authorized.map(([, [label, url]]) =>
      '<a href="' + url + '" target="_blank" rel="noopener noreferrer"><span style="color:#174c83;font-size:16px;font-weight:bold;">' + label.replace(' ', '&nbsp;') + '</span></a>');
    links.html = '<p><span style="color:#143654;font-size:16px;font-weight:bold;">My Workspaces 我的工作室</span></p>' +
      '<p>' + anchors.join(' &nbsp; ') + '</p>';
    await workspaceSection.expand();
    return true;
  }
  async function load() {
    if (!authentication.loggedIn()) {
      await clearLinks();
      send('signed-out');
      return;
    }
    const staff = await getLtposWorkspaces();
    const nativeLinks = await renderLinks(staff.workspaceIds);
    send(nativeLinks ? 'ready' : 'no-access', { ...staff, nativeLinks });
  }
  frame.onMessage(async ({ data }) => {
    if (!data || !['LTPOS_READY', 'LTPOS_SIGN_IN', 'LTPOS_SIGN_OUT'].includes(data.type) || busy) return;
    busy = true;
    try {
      if (data.type === 'LTPOS_SIGN_OUT' && authentication.loggedIn()) {
        await clearLinks();
        await authentication.logout();
      }
      if (data.type === 'LTPOS_SIGN_IN' && !authentication.loggedIn()) {
        try { await authentication.promptLogin({ mode: 'login', modal: true }); }
        catch { send('signed-out'); return; }
      }
      await load();
    } catch {
      await clearLinks();
      send('unavailable');
    } finally {
      busy = false;
    }
  });
  frame.src = FRAME;
});
