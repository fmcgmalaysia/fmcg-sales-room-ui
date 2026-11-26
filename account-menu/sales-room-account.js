import { mountAccountMenu } from './account-menu.js';
import { requestFrameLogout } from './frame-logout.js';

const staff = document.getElementById('staffNameMobile');
const existingLogout = document.getElementById('logoutBtn');
if (staff && existingLogout) {
  mountAccountMenu(existingLogout.parentElement, {
    getProfile() {
      const name = staff.textContent.trim();
      if (!name || name === 'Loading Account…') return null;
      return { name, context: 'FMCG Malaysia · Sales Room' };
    },
    signOut() {
      return requestFrameLogout(() => existingLogout.click());
    }
  });
}
