import { authentication, currentMember } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { session } from 'wix-storage-frontend';
import { getCurrentStaffContext } from 'backend/staffAuth.web';

const SITE_BASE = 'https://www.fmcgmalaysia.com';
const GOOGLE_START_URL = SITE_BASE + '/_functions/googleStaffAuthStart';
const SALES_ROOM_URL = '/sales-room';
const LOGIN_URL = '/sales-room-login';
const STATE_KEY = 'salesRoomGoogleOAuthState';
const RETURN_KEY = 'salesRoomGoogleOAuthReturn';
const READY_LABEL = 'Continue with Google';

let googleReturnPromise = null;

function setButton(label) {
  $w('#button1').label = label;
}

function newState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function verifyStaffAndEnter() {
  try {
    const staff = await getCurrentStaffContext();
    if (staff && staff.authorized) {
      setButton('ACCESS VERIFIED • OPENING SALES ROOM…');
      wixLocationFrontend.to(SALES_ROOM_URL);
      return true;
    }
    setButton('ACCOUNT NOT AUTHORIZED • TRY AGAIN');
  } catch (error) {
    setButton('UNABLE TO VERIFY • TRY AGAIN');
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
    setButton(query.oauth === 'cancelled' ? READY_LABEL : 'ACCOUNT NOT AUTHORIZED • TRY AGAIN');
    return true;
  }

  if (!alreadyValidated && (!expectedState || returnedState !== expectedState || !token)) {
    session.removeItem(STATE_KEY);
    session.removeItem(RETURN_KEY);
    setButton('SECURITY CHECK FAILED • TRY AGAIN');
    return true;
  }

  session.setItem(RETURN_KEY, fingerprint);
  $w('#button1').disable();
  setButton('VERIFYING STAFF ACCESS…');

  try {
    await authentication.applySessionToken(token);
    session.removeItem(STATE_KEY);
    const entered = await verifyStaffAndEnter();
    if (!entered) session.removeItem(RETURN_KEY);
  } catch (error) {
    session.removeItem(STATE_KEY);
    session.removeItem(RETURN_KEY);
    setButton('SIGN-IN COULD NOT BE COMPLETED • TRY AGAIN');
    wixLocationFrontend.to(LOGIN_URL);
  } finally {
    $w('#button1').enable();
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
  $w('#button1').disable();
  setButton('OPENING GOOGLE ACCOUNT CHOOSER…');

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
    setButton('GOOGLE SIGN-IN NOT AVAILABLE • TRY AGAIN');
    $w('#button1').enable();
  }
}

$w.onReady(async function () {
  $w('#text10').text = 'SALES ROOM\nFMCG STAFF ONLY';
  setButton(READY_LABEL);

  try {
    $w('#text10').style.color = '#FFFFFF';
    $w('#button1').style.backgroundColor = '#FFFFFF';
    $w('#button1').style.color = '#202124';
    $w('#button1').style.borderColor = '#DADCE0';
  } catch (error) {}

  $w('#button1').onClick(continueWithGoogle);
  $w('#imageX36').onClick(continueWithGoogle);
  await handleGoogleReturn();
});
