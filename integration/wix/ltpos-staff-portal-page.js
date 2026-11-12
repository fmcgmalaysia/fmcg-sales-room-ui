import { authentication } from 'wix-members-frontend';
import wixLocation from 'wix-location-frontend';
import { getLtposWorkspaces } from 'backend/ltposWorkspaces.web';

const FRAME = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/ltpos/';
const SITE = 'https://fmcg999.wixstudio.com/master';
const paths = new Map([
  ['purchase', SITE],
  ['support', SITE + '/support-department'],
  ['warehouse', SITE + '/warehouse-department'],
  ['finance', SITE + '/account-department']
]);

$w.onReady(() => {
  const frame = $w('#html1');
  let busy = false;
  const send = (state, details = {}) => frame.postMessage({ type: 'LTPOS_SESSION', state, ...details });
  async function load() {
    if (!authentication.loggedIn()) {
      send('signed-out');
      return;
    }
    const staff = await getLtposWorkspaces();
    send(staff.workspaceIds.length ? 'ready' : 'no-access', staff);
  }
  frame.onMessage(async ({ data }) => {
    if (!data || !['LTPOS_READY', 'LTPOS_SIGN_IN', 'LTPOS_OPEN', 'LTPOS_SIGN_OUT'].includes(data.type) || busy) return;
    busy = true;
    try {
      if (data.type === 'LTPOS_SIGN_OUT' && authentication.loggedIn()) await authentication.logout();
      if (data.type === 'LTPOS_SIGN_IN' && !authentication.loggedIn()) {
        try { await authentication.promptLogin({ mode: 'login', modal: true }); }
        catch { send('signed-out'); return; }
      }
      if (data.type === 'LTPOS_OPEN') {
        if (!paths.has(data.id) || !authentication.loggedIn()) { await load(); return; }
        const staff = await getLtposWorkspaces();
        if (staff.workspaceIds.includes(data.id)) wixLocation.to(paths.get(data.id));
        else send(staff.workspaceIds.length ? 'ready' : 'no-access', staff);
        return;
      }
      await load();
    } catch {
      send('unavailable');
    } finally {
      busy = false;
    }
  });
  frame.src = FRAME;
});
