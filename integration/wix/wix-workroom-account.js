import { getLtposWorkspaces } from 'backend/ltposWorkspaces.web';
import { authentication } from 'wix-members-frontend';
import wixLocation from 'wix-location-frontend';
import { connectAccountSession } from 'public/wix-account-session.js';

export function connectWorkroomAccount(frame, workspace, options = {}) {
  const loginPath = '/';
  const session = connectAccountSession([frame], loginPath, options.onExit);
  let profile;
  frame.onMessage(async ({ data }) => {
    if (data?.type === 'HEADER_ACCOUNT_READY') {
      if (authentication.loggedIn() && !profile) {
        profile = getLtposWorkspaces().catch(() => null);
      }
      const current = await profile;
      const signedIn = authentication.loggedIn() && Boolean(current?.name) &&
        (!workspace || current.workspaceIds?.includes(workspace));
      frame.postMessage({ type: 'HEADER_ACCOUNT_STATUS', signedIn, name: signedIn ? current.name : '' });
    } else if (data?.type === 'HEADER_ACCOUNT_SIGN_IN') {
      if (options.signIn) await options.signIn();
      else wixLocation.to(loginPath);
    } else if (data?.type === 'HEADER_ACCOUNT_LOGOUT') {
      await session.signOut();
    }
  });
  return session;
}
