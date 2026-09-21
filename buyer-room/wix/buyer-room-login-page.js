import wixSeoFrontend from 'wix-seo-frontend';
import { authentication, currentMember } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { session } from 'wix-storage-frontend';
import { getCurrentBuyerContext } from 'backend/catalogueAuth.web';

const FRAME_ID = '#html1';
const SITE_BASE = 'https://fmcg999.wixstudio.com/fmcgmalaysia';
const GOOGLE_START_URL = SITE_BASE + '/_functions/googleBuyerAuthStart';
const BUYER_DESTINATION = '/catalogue';
const LOGIN_URL = '/buyer-room-login';
const WHATSAPP_NUMBER = '60177735375';
const STATE_KEY = 'buyerRoomGoogleOAuthState';
const RETURN_KEY = 'buyerRoomGoogleOAuthReturn';

let googleReturnPromise = null;

function postToLogin(message) {
  try {
    $w(FRAME_ID).postMessage(message);
  } catch (error) {
    console.error('Buyer login message failed', error);
  }
}

function setBusy(busy, message = '') {
  postToLogin({ type: 'BUYER_LOGIN_BUSY', busy, message });
}

function showStatus(kind, message) {
  postToLogin({ type: 'BUYER_LOGIN_STATUS', kind, message });
}

function buyerErrorMessage(reason) {
  if (reason === 'INACTIVE') {
    return 'Your buyer account is not active. Please contact FMCG Malaysia.';
  }
  return 'This account is not authorized in Customer Master. Please apply for buyer access or contact our team.';
}

function oauthErrorMessage(status) {
  if (status === 'cancelled') return 'Google sign-in was cancelled.';
  if (status === 'not_authorized') return 'This Google account is not an active authorized buyer account.';
  if (status === 'invalid_state') return 'The secure sign-in session expired. Please try again.';
  return 'Google sign-in could not be completed. Please try again.';
}

function newState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'B_' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function authorizeAndEnter({ silent = false } = {}) {
  const result = await getCurrentBuyerContext();
  if (result?.ok) {
    showStatus('success', 'Access approved. Opening Buyer Room…');
    wixLocationFrontend.to(BUYER_DESTINATION);
    return true;
  }
  if (!silent && result?.reason !== 'NOT_LOGGED_IN') {
    showStatus('error', buyerErrorMessage(result?.reason));
  }
  return false;
}

async function processGoogleReturn(query) {
  const returnedState = String(query.state || '');
  const token = String(query.token || '');
  const fingerprint = returnedState + ':' + token;
  const expectedState = session.getItem(STATE_KEY) || '';
  const alreadyValidated = session.getItem(RETURN_KEY) === fingerprint;

  if (query.oauth !== 'success') {
    session.removeItem(STATE_KEY);
    session.removeItem(RETURN_KEY);
    setBusy(false);
    showStatus('error', oauthErrorMessage(String(query.oauth || 'google_error')));
    return true;
  }

  if (!alreadyValidated && (!expectedState || returnedState !== expectedState || !token)) {
    session.removeItem(STATE_KEY);
    session.removeItem(RETURN_KEY);
    setBusy(false);
    showStatus('error', 'The secure sign-in check failed. Please try again.');
    return true;
  }

  session.setItem(RETURN_KEY, fingerprint);
  setBusy(true, 'Verifying buyer access…');
  try {
    await authentication.applySessionToken(token);
    session.removeItem(STATE_KEY);
    const entered = await authorizeAndEnter();
    if (!entered) session.removeItem(RETURN_KEY);
  } catch (error) {
    session.removeItem(STATE_KEY);
    session.removeItem(RETURN_KEY);
    setBusy(false);
    showStatus('error', 'Google sign-in could not be completed. Please try again.');
    wixLocationFrontend.to(LOGIN_URL);
  }
  return true;
}

function handleGoogleReturn() {
  const query = wixLocationFrontend.query || {};
  if (!query.oauth) return Promise.resolve(false);
  if (!googleReturnPromise) googleReturnPromise = processGoogleReturn(query);
  return googleReturnPromise;
}

async function continueWithGoogle() {
  setBusy(true, 'Opening Google account chooser…');
  try {
    const state = newState();
    session.setItem(STATE_KEY, state);
    session.removeItem(RETURN_KEY);
    try {
      const member = await currentMember.getMember();
      if (member) await authentication.logout();
    } catch (error) {}
    wixLocationFrontend.to(GOOGLE_START_URL + '?state=' + encodeURIComponent(state));
  } catch (error) {
    session.removeItem(STATE_KEY);
    session.removeItem(RETURN_KEY);
    setBusy(false);
    showStatus('error', 'Google sign-in is not available. Please try again.');
  }
}

function openWhatsApp(message) {
  const url = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
  wixLocationFrontend.to(url);
}

$w.onReady(async function () {
  const frame = $w(FRAME_ID);

  frame.onMessage(async event => {
    const message = event.data || {};

    if (message.type === 'BUYER_LOGIN_READY') {
      if (!(await handleGoogleReturn())) await authorizeAndEnter({ silent: true });
      return;
    }

    if (message.type === 'BUYER_LOGIN_GOOGLE') {
      await continueWithGoogle();
      return;
    }

    if (message.type === 'BUYER_LOGIN_EMAIL') {
      const email = String(message.email || '').trim();
      const password = String(message.password || '');
      if (!email || !password) {
        showStatus('error', 'Please enter your email and password.');
        return;
      }
      setBusy(true, 'Signing in securely…');
      try {
        await authentication.login(email, password);
        const allowed = await authorizeAndEnter();
        if (!allowed) setBusy(false);
      } catch (error) {
        setBusy(false);
        showStatus('error', 'Email or password is incorrect. Please try again.');
      }
      return;
    }

    if (message.type === 'BUYER_FORGOT_PASSWORD') {
      authentication.promptForgotPassword().catch(() => {});
      return;
    }

    if (message.type === 'BUYER_APPLY_ACCESS') {
      openWhatsApp('Hello FMCG Malaysia, I would like to apply for Buyer Room access.');
      return;
    }

    if (message.type === 'BUYER_CONTACT') {
      openWhatsApp('Hello FMCG Malaysia, I need help with Buyer Room access.');
    }
  });

  $w('#imageX38').alt = 'Malaysian FMCG sourcing specialists reviewing export-ready food and consumer products in the FMCG Malaysia Buyer Room';
  wixSeoFrontend.setTitle('Buyer Room Login | Malaysian FMCG Sourcing Platform');
  wixSeoFrontend.setMetaTags([
    { name: 'description', content: 'Sign in to FMCG Malaysia Buyer Room to source Malaysian FMCG products, explore export-ready selections and connect with trusted suppliers.' },
    { property: 'og:title', content: 'FMCG Malaysia Buyer Room' },
    { property: 'og:description', content: 'A secure sourcing platform for international buyers looking for Malaysian FMCG products and trusted supplier support.' }
  ]);
});
