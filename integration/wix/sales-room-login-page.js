import { authentication, currentMember } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { session } from 'wix-storage-frontend';
import { getCurrentStaffContext } from 'backend/staffAuth.web';

const SITE_BASE = 'https://www.fmcgmalaysia.com';
const GOOGLE_START_URL = SITE_BASE + '/_functions/googleStaffAuthStart';
const SALES_ROOM_URL = '/sales-room';
const STATE_KEY = 'salesRoomGoogleOAuthState';
const RETURN_KEY = 'salesRoomGoogleOAuthReturn';
const READY_LABEL = 'Continue with Google';
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
}

let googleReturnPromise = null;

function setButton(label) {
  $w('#button1').label = label;
  if (label === READY_LABEL) $w('#imageX36').show();
  else $w('#imageX36').hide();
}

function clearGoogleReturn() {
  try { wixLocationFrontend.queryParams.remove(['oauth', 'state', 'token']); } catch (_) {}
}

function newState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function readStaffContext() {
  try {
    return await getCurrentStaffContext();
  } catch (_) {
    return { authorized: false, reason: 'MEMBER_LOOKUP_ERROR' };
  }
}

const transientStaffFailure = new Set(['NOT_LOGGED_IN', 'MEMBER_LOOKUP_ERROR', 'STAFF_CMS_QUERY_ERROR', 'MASTER_STAFF_ACCESS_UNAVAILABLE']);

async function verifyStaffAndEnter(justSignedIn = false) {
  let staff = await readStaffContext();
  if (justSignedIn && !staff?.authorized && transientStaffFailure.has(staff?.reason)) {
    await new Promise(resolve => setTimeout(resolve, 600));
    staff = await readStaffContext();
  }
  if (staff?.authorized) {
    setButton('OPENING SALES ROOM…');
    wixLocationFrontend.to(staffReturnTarget());
    return true;
  }
  if (staff?.reason === 'VERIFIED_STAFF_EMAIL_REQUIRED') setButton('STAFF EMAIL APPROVAL REQUIRED');
  else if (transientStaffFailure.has(staff?.reason)) setButton('UNABLE TO VERIFY • TRY AGAIN');
  else setButton('ACCOUNT NOT AUTHORIZED • TRY AGAIN');
  return false;
}

async function processGoogleReturn(query) {
  const status = String(query.oauth || '');
  const returnedState = String(query.state || '');
  const token = String(query.token || '');
  const expectedState = session.getItem(STATE_KEY) || '';
  clearGoogleReturn();
  session.removeItem(RETURN_KEY);

  if (status !== 'success') {
    session.removeItem(STATE_KEY);
    if (status === 'cancelled') setButton(READY_LABEL);
    else if (status === 'not_authorized') setButton('ACCOUNT NOT AUTHORIZED • TRY AGAIN');
    else if (status === 'unverified_email') setButton('VERIFY YOUR GOOGLE EMAIL');
    else if (status === 'invalid_state') setButton('SECURITY CHECK FAILED • TRY AGAIN');
    else setButton('GOOGLE SIGN-IN FAILED • TRY AGAIN');
    return true;
  }

  if (!expectedState || returnedState !== expectedState || !token) {
    session.removeItem(STATE_KEY);
    session.removeItem(RETURN_KEY);
    setButton('SECURITY CHECK FAILED • TRY AGAIN');
    return true;
  }

  $w('#button1').disable();
  setButton('VERIFYING STAFF ACCESS…');

  try {
    await authentication.applySessionToken(token);
    session.removeItem(STATE_KEY);
    await verifyStaffAndEnter(true);
  } catch (error) {
    session.removeItem(STATE_KEY);
    session.removeItem(RETURN_KEY);
    setButton('SESSION FAILED • TRY AGAIN');
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
  const requested=validStaffTarget(wixLocationFrontend.query?.next||'');
  if(requested)session.setItem(TARGET_KEY,JSON.stringify({target:requested,expiresAt:Date.now()+10*60*1000}));
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
  const handled=await handleGoogleReturn();
  if(!handled && authentication.loggedIn())await verifyStaffAndEnter();
});
