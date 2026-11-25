import { salesRoomShipment } from 'backend/onboarding.web';
import { createSalesRoomCustomer, getSalesRoomCustomers, getSalesRoomCustomerDetail, getAssignableSalesStaff, updateSalesRoomCustomerProfile, updateSalesRoomSelectionLimit, saveSalesRoomCustomerUser, getSalesRoomCustomerAudit, recordSalesRoomActivity, getSalesRoomActivityForAdmin, getSalesRoomCustomersOperational, getSalesRoomConfirmedOrders, getSalesRoomOrderDetail, checkSalesRoomOrderReceipt, getSalesRoomOrderForm, submitSalesRoomOrder, createSalesRoomProforma, confirmSalesRoomOrderForm, updateSalesRoomCustomerLifecycle, addSalesRoomCustomerUser, reviewSalesRoomCustomerUser, getSalesRoomOrderProgress, saveSalesRoomOrderQty, saveSalesRoomOrderPo, saveSalesRoomOrderPlanning } from 'backend/onboarding.web';
import { getFxRateSettings, saveAndSyncFxRates } from 'backend/fxRates.web.js';
import { getCurrentStaffContext, recordStaffPresence, getStaffPresenceForAdmin } from 'backend/staffAuth.web.js';
import wixLocationFrontend from 'wix-location-frontend';
import { authentication } from 'wix-members-frontend';
import wixRealtimeFrontend from 'wix-realtime-frontend';
import { session } from 'wix-storage-frontend';

const STAFF_LOGIN_URL = '/sales-room-login';
const PRESENCE_HEARTBEAT_MS = 60 * 1000;
let presenceHeartbeatTimer;

const ACCESS_DENIED_STAFF = Object.freeze({
  authorized: false,
  staffId: '',
  staffName: 'ACCESS DENIED',
  role: '',
  reason: 'STAFF_NOT_AUTHORIZED'
});

function deniedStaff(reason) {
  const safeReason = String(reason || ACCESS_DENIED_STAFF.reason)
    .replace(/[^A-Z0-9_]/gi, '')
    .slice(0, 48);

  return {
    ...ACCESS_DENIED_STAFF,
    staffName: `ACCESS DENIED [${safeReason}]`,
    reason: safeReason
  };
}

async function loadCurrentStaff() {
  try {
    const staff = await getCurrentStaffContext();
    return staff?.authorized
      ? staff
      : deniedStaff(staff?.reason);
  } catch (error) {
    return deniedStaff('STAFF_CONTEXT_FAILED');
  }
}

$w.onReady(function () {
  const salesRoom = $w('#html1');
  salesRoom.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/sales-room-20261125-company-consent.html';
  const staffPromise = loadCurrentStaff();
  // Only files returned by the authorized history read may leave the embed.
  const historyFiles = new Map();
  function openHistoryFile(message) {
    const saved = historyFiles.get(message.company);
    if (!saved || saved.requestId !== message.requestId || saved.customerId !== message.customerId) return;
    const file = saved.documents?.find(file => file.fileId === message.fileId && file.ready === true);
    if (!file || !/^[A-Za-z0-9_-]{10,200}$/.test(file.fileId) || file.url !== 'https://drive.google.com/file/d/' + file.fileId + '/view') return;
    wixLocationFrontend.to(file.url);
  }
  let currentDevice = 'UNKNOWN';
  let customerRefreshPromise;
  let readyBootstrapInFlight = false;
  function refreshCustomersFromCms() {
    if (customerRefreshPromise) return customerRefreshPromise;
    customerRefreshPromise = getSalesRoomCustomersOperational()
      .then((response) => {
        salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMERS', ...response });
        return response;
      })
      .catch((error) => salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMERS', ok: false, error: error?.message || 'Customer List Could Not Be Loaded.' }))
      .finally(() => { customerRefreshPromise = null; });
    return customerRefreshPromise;
  }

  wixRealtimeFrontend.subscribe({ name: 'sales-room-signals' }, async () => {
    await refreshCustomersFromCms();
  }).catch((error) => console.error('Sales Room realtime subscription failed', error));

  async function syncPresence(staff, mode) {
    try {
      const recorded = await recordStaffPresence({
        mode,
        device: currentDevice
      });

      

      if (staff.canViewAllCustomers) {
        const presence = await getStaffPresenceForAdmin();
        salesRoom.postMessage({
          type: 'SALES_ROOM_STAFF_PRESENCE',
          ...presence
        });
      }
    } catch (error) {
      if (staff.canViewAllCustomers) {
        salesRoom.postMessage({
          type: 'SALES_ROOM_STAFF_PRESENCE',
          ok: false,
          error: 'Staff activity could not be refreshed.'
        });
      }
    }
  }

  async function refreshSalesActivity(staff, dayOffset = 0) {
    if (!staff?.authorized || !staff.canViewAllCustomers) return;
    try {
      const activity = await getSalesRoomActivityForAdmin(dayOffset);
      salesRoom.postMessage({
        type: 'SALES_ROOM_ACTIVITY',
        ...activity
      });
    } catch (error) {
      salesRoom.postMessage({
        type: 'SALES_ROOM_ACTIVITY',
        ok: false,
        error: 'Today activity could not be refreshed.'
      });
    }
  }

  function showStaffAccessIssue(staff) {
    if (!authentication.loggedIn()) { wixLocationFrontend.to(STAFF_LOGIN_URL); return; }
    const message=staff?.reason==='MASTER_STAFF_ACCESS_UNAVAILABLE'?'Staff access is temporarily unavailable. The system will check again.':'Staff Management does not allow this customer work. Contact your administrator.';
    salesRoom.postMessage({type:'SALES_ROOM_CUSTOMERS',ok:false,error:message});
  }
  staffPromise.then(staff => { if (!staff.authorized) showStaffAccessIssue(staff); });

  salesRoom.onMessage(async (event) => {
    const message = event.data || {};


    if (message.type === 'SALES_ROOM_OPEN_BUYER_ROOM') {
      const customerId = String(message.customerId || '').trim();
      if (!/^CUS-[A-Za-z0-9-]+$/.test(customerId)) return;
      const preparing = message.prepare === true;
      // Use the loaded Sales Room scope for navigation only. The destination checks current access before returning customer data.
      const staff = await staffPromise;
      if (!staff.authorized) {
        if (!preparing) showStaffAccessIssue(staff);
        return;
      }
      const can=action=>staff.customerScope?.allCustomers===true || staff.customerScope?.allCustomerActions?.includes(action) || staff.customerScope?.customerActions?.[action]?.includes(customerId);
      const buyerRoom = can('BUYER_ROOM_VIEW');
      if (!buyerRoom && !can('CATALOGUE_VIEW')) {
        if (!preparing) showStaffAccessIssue({reason:'CUSTOMER_ACTION_DENIED'});
        return;
      }
      const target = (buyerRoom ? '/buyer-room' : '/catalogue') + '?assist=' + encodeURIComponent(customerId);
      const signedIn = authentication.loggedIn();
      const entryUrl = signedIn ? target : STAFF_LOGIN_URL + '?next=' + encodeURIComponent(target);
      if (preparing) {
        salesRoom.postMessage({
          type: 'SALES_ROOM_BUYER_ENTRY_LINK', customerId, requestId: message.requestId, entryUrl
        });
        return;
      }
      if (!signedIn) {
        wixLocationFrontend.to(entryUrl);
        return;
      }
      if (buyerRoom) {
        try {
          session.setItem('staffBuyerEntryV1', JSON.stringify({ customerId, staffId: staff.staffId, expiresAt: Date.now() + 30000 }));
        } catch (error) { /* The explicit URL still carries the requested customer. */ }
      }
      wixLocationFrontend.to(target);
      return;
    }

    if (message.type === 'SALES_ROOM_FX_RATES_REQUEST') {
      try {
        const response = await getFxRateSettings();
        salesRoom.postMessage({ type: 'SALES_ROOM_FX_RATES_DATA', requestId: message.requestId, ...response });
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_FX_RATES_DATA', requestId: message.requestId, ok: false, error: error?.message || 'FX rates could not be loaded.' });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_FX_RATES_APPLY') {
      try {
        const response = await saveAndSyncFxRates(message.rates);
        salesRoom.postMessage({ type: 'SALES_ROOM_FX_RATES_APPLY_RESULT', requestId: message.requestId, ...response });
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_FX_RATES_APPLY_RESULT', requestId: message.requestId, ok: false, error: error?.message || 'FX rates could not be saved and applied.' });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_READY') {
      const staff = await staffPromise;
      const safeStaff = staff.authorized
        ? {
            authorized: true,
            staffId: staff.staffId,
            staffName: staff.staffName,
            loginEmail: staff.loginEmail,
            role: staff.role,
            canViewAllCustomers: staff.canViewAllCustomers,
            canBrowseAllCustomers: staff.canBrowseAllCustomers
          }
        : {
            authorized: false,
            reason: staff.reason
          };

      salesRoom.postMessage({
        type: 'SALES_ROOM_STAFF',
        staff: safeStaff
      });

      if (staff.authorized && !readyBootstrapInFlight) {
        readyBootstrapInFlight = true;
        try {
          await Promise.all([
            refreshCustomersFromCms(),
            (async () => {
              try {
                await recordSalesRoomActivity({ action: 'SALES_ROOM_ENTER' });
              } catch (error) {
                // Activity logging must never block staff work.
              }
              await refreshSalesActivity(staff, 0);
            })(),
            (async () => {
              try {
                const routing = await getAssignableSalesStaff();
                salesRoom.postMessage({ type: 'SALES_ROOM_ASSIGNABLE_STAFF', ...routing });
              } catch (error) {
                salesRoom.postMessage({
                  type: 'SALES_ROOM_ASSIGNABLE_STAFF',
                  ok: false,
                  error: error?.message || 'Assignable staff could not be loaded.'
                });
              }
            })()
          ]);
        } finally {
          readyBootstrapInFlight = false;
        }
      }
      return;
    }

    if (message.type === 'SALES_ROOM_LOGOUT') {
      await authentication.logout();
      wixLocationFrontend.to(STAFF_LOGIN_URL);
      return;
    }

    if (message.type === 'SALES_ROOM_CATALOGUE_PREVIEW_REQUEST') {
      const staff = await staffPromise;
      if (!staff.authorized) {
        wixLocationFrontend.to(STAFF_LOGIN_URL);
        return;
      }

      wixLocationFrontend.to('/catalogue');
      return;
    }

    if (message.type === 'SALES_ROOM_CUSTOMER_DETAIL_REQUEST') {
      try {
        const response = await getSalesRoomCustomerDetail(
          message.customerId || ''
        );
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_DETAIL',
          ...(message.profileSaveRequestId ? { profileSaveRequestId: message.profileSaveRequestId } : {}),
          ...response
        });
      } catch (error) {
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_DETAIL',
          ...(message.profileSaveRequestId ? { profileSaveRequestId: message.profileSaveRequestId } : {}),
          ok: false,
          error: error?.message || 'Customer detail could not be loaded.'
        });
      }
      return;
    }



    if (message.type === 'SALES_ROOM_CUSTOMERS_REQUEST') {
      await refreshCustomersFromCms();
      return;
    }

    if (message.type === 'SALES_ROOM_CUSTOMER_LIFECYCLE_UPDATE') {
      try {
        const response = await updateSalesRoomCustomerLifecycle(message.customerId || '', message.action || '', message.payload || {});
        salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMER_LIFECYCLE_RESULT', ...response });
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMER_LIFECYCLE_RESULT', ok: false, customerId: message.customerId || '', error: error?.message || 'Customer Account Could Not Be Updated.' });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_SELECTION_LIMIT_SAVE') {
      try {
        const response = await updateSalesRoomSelectionLimit(message.customerId || '', message.selectionLimit);
        salesRoom.postMessage({ type: 'SALES_ROOM_SELECTION_LIMIT_RESULT', ...response });
        await refreshCustomersFromCms();
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_SELECTION_LIMIT_RESULT', ok: false, customerId: message.customerId || '', error: error?.message || 'Selection allowance could not be saved.' });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_CUSTOMER_PROFILE_SAVE') {
      try {
        const response = await updateSalesRoomCustomerProfile(
          message.customerId || '',
          message.payload || {}
        );
        const currentStaff = await staffPromise;
        if (response?.ok && Array.isArray(response.changedFields) && response.changedFields.length) {
          try {
            await recordSalesRoomActivity({
              action: 'CUSTOMER_UPDATED',
              customerId: message.customerId || '',
              fieldLabel: response.changedFields.join(', ')
            });
          } catch (error) {
            // Existing field-level audit remains the source of truth.
          }
          await refreshSalesActivity(currentStaff, 0);
        }
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_PROFILE_RESULT',
          requestId: message.requestId || '',
          ...response
        });
      } catch (error) {
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_PROFILE_RESULT',
          requestId: message.requestId || '',
          ok: false,
          error: error?.message || 'Customer profile could not be saved.'
        });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_CUSTOMER_USER_ADD') {
      try {
        const response = await addSalesRoomCustomerUser(message.customerId || '', message.payload || {}, message.requestId || '');
        salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMER_USER_RESULT', ...response, action: 'ADD', message: 'Customer user added and activated.' });
        await refreshCustomersFromCms();
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMER_USER_RESULT', ok: false, customerId: message.customerId || '', action: 'ADD', error: error?.message || 'Customer user could not be added.' });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_CUSTOMER_USER_ACTION') {
      try {
        const response = await reviewSalesRoomCustomerUser(message.customerId || '', message.userId || '', message.action || '', message.payload || {});
        salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMER_USER_RESULT', ...response, message: 'Customer user access updated.' });
        await refreshCustomersFromCms();
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMER_USER_RESULT', ok: false, customerId: message.customerId || '', action: message.action || '', error: error?.message || 'Customer user access could not be updated.' });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_CUSTOMER_USER_SAVE') {
      try {
        const response = await saveSalesRoomCustomerUser(
          message.customerId || '',
          message.slotNumber,
          message.payload || {}
        );
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_USER_RESULT',
          ...response
        });
      } catch (error) {
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_USER_RESULT',
          ok: false,
          error: error?.message || 'Customer user could not be saved.'
        });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_CUSTOMER_AUDIT_REQUEST') {
      try {
        const response = await getSalesRoomCustomerAudit(message.customerId || '');
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_AUDIT',
          ...response
        });
      } catch (error) {
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_AUDIT',
          ok: false,
          error: error?.message || 'Customer change history could not be loaded.'
        });
      }
      return;
    }



    if (message.type === 'SALES_ROOM_ACTIVITY_REQUEST') {
      const currentStaff = await staffPromise;
      await refreshSalesActivity(currentStaff, message.dayOffset || 0);
      return;
    }
    if (message.type === 'SALES_ROOM_CONFIRMED_ORDERS_REQUEST') {
      try { salesRoom.postMessage({ type: 'SALES_ROOM_CONFIRMED_ORDERS', ...(await getSalesRoomConfirmedOrders()) }); }
      catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_CONFIRMED_ORDERS', ok: false, error: error?.message || 'Incoming orders could not be loaded.' }); }
      return;
    }
    if(message.type==='CUSTOMER_HISTORY_FILE_OPEN'){openHistoryFile(message);return;}
    if(message.type==='SALES_ROOM_SHIPMENT_REQUEST'){
      const pending=message.action==='HISTORY'?{requestId:message.requestId,customerId:message.customerId}:null;
      if(pending)historyFiles.set(message.company,pending);
      try{const result=await salesRoomShipment(message.customerId,message.company,message.action,message.requestId,message.input);if(pending&&historyFiles.get(message.company)===pending&&result.company===message.company&&result.customerId===pending.customerId)pending.documents=result.documents;salesRoom.postMessage({type:'SALES_ROOM_SHIPMENT_RESULT',requestId:message.requestId,company:message.company,ok:true,result});}
      catch(error){salesRoom.postMessage({type:'SALES_ROOM_SHIPMENT_RESULT',requestId:message.requestId,company:message.company,ok:false,error:error?.message||'Shipment request could not be confirmed.'});}return;
    }
    if (message.type === 'SALES_ROOM_ORDER_PROGRESS_REQUEST') {
      const customerId = String(message.customerId || '').trim();
      try {
        if (!customerId) throw new Error('Select a customer first.');
        salesRoom.postMessage({
          type: 'SALES_ROOM_ORDER_PROGRESS',
          requestId: message.requestId,
          ...(await getSalesRoomOrderProgress(customerId))
        });
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_PROGRESS', requestId: message.requestId, ok: false, customerId, error: error?.message || 'Customer progress could not be loaded.' });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_ORDER_DETAIL_REQUEST') {
      try {
        const checked = await checkSalesRoomOrderReceipt(message.orderId || '');
        if (checked.receipt) salesRoom.postMessage({ type: 'SALES_ROOM_CONFIRMED_ORDERS', ...(await getSalesRoomConfirmedOrders()) });
        salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_DETAIL', ...(await getSalesRoomOrderDetail(message.orderId || '')) });
      }
      catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_DETAIL', ok: false, error: error?.message || 'Order detail could not be loaded.' }); }
      return;
    }
    if (message.type === 'SALES_ROOM_ORDER_QTY_UPDATE') {
      try {
        const result = await saveSalesRoomOrderQty(message.orderId || '', message.lineId || '', message.quantityCtn, message.expectedRevision, message.requestId || '');
        salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_QTY_RESULT', requestId: message.requestId, ...result });
      } catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_QTY_RESULT', requestId: message.requestId, ok: false, error: error?.message || 'Quantity could not be saved.' }); }
      return;
    }
    if (message.type === 'SALES_ROOM_ORDER_PO_UPDATE') {
      try {
        const result = await saveSalesRoomOrderPo(message.orderId || '', message.customerPoNumber, message.expectedRevision, message.requestId || '');
        salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_PO_RESULT', requestId: message.requestId, ...result });
      } catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_PO_RESULT', requestId: message.requestId, ok: false, error: error?.message || 'P.O. number could not be saved.' }); }
      return;
    }
    if (message.type === 'SALES_ROOM_ORDER_PLANNING_UPDATE') {
      try {
        const result = await saveSalesRoomOrderPlanning(message.orderId || '', message.customerPoNumber, message.estimatedShipmentDate, message.expectedRevision, message.requestId || '', message.expectedShipmentRevision, message.stockCurrent);
        salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_PLANNING_RESULT', requestId: message.requestId, ...result });
      } catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_PLANNING_RESULT', requestId: message.requestId, ok: false, error: error?.message || 'Order details could not be saved.' }); }
      return;
    }
    if (message.type === 'SALES_ROOM_ORDER_FORM_REQUEST') {
      try { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_FORM', ...(await getSalesRoomOrderForm(message.customerId || '')) }); }
      catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_FORM', ok: false, error: error?.message || 'Order Form could not be loaded.' }); }
      return;
    }
    if (message.type === 'SALES_ROOM_ORDER_FORM_CONFIRM') {
      try { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ...(await confirmSalesRoomOrderForm(message.customerId || '', message.lines || [])) }); }
      catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ok: false, error: error?.message || 'Order could not be confirmed.' }); }
      return;
    }
    if (message.type === 'SALES_ROOM_NCT_RECEIPT_REQUEST') {
      try {
        const detail = await checkSalesRoomOrderReceipt(message.orderId || '');
        salesRoom.postMessage({ type: 'SALES_ROOM_NCT_RECEIPT_RESULT', requestId: message.requestId,
          orderId: message.orderId, ok: true, receipt: detail.receipt || null });
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_NCT_RECEIPT_RESULT', requestId: message.requestId,
          orderId: message.orderId, ok: false, error: error?.message || 'Receipt could not be checked.' });
      }
      return;
    }
    if (message.type === 'SALES_ROOM_SUBMIT_ORDER') {
      try { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', requestId: message.requestId || '', action: message.destination === 'NCT' ? 'SUBMIT_NCT' : message.destination === 'GHR' ? 'SUBMIT_GHR' : '', ...(await submitSalesRoomOrder(message.orderId || '', message.destination || '')) }); }
      catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', requestId: message.requestId || '', orderId: message.orderId || '', action: message.destination === 'NCT' ? 'SUBMIT_NCT' : message.destination === 'GHR' ? 'SUBMIT_GHR' : '', ok: false, error: error?.message || 'Order could not be submitted.' }); }
      return;
    }
    if (message.type === 'SALES_ROOM_CREATE_PROFORMA') {
      try { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ...(await createSalesRoomProforma(message.orderId || '')) }); }
      catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ok: false, error: error?.message || 'Proforma request could not be created.' }); }
      return;
    }

    if (message.type !== 'SALES_ROOM_CREATE_CUSTOMER') return;

    const staff = await staffPromise;
    if (!staff.authorized) {
      salesRoom.postMessage({
        type: 'SALES_ROOM_CREATE_RESULT',
        ok: false,
        error: 'Staff sign-in and authorization are required.'
      });
      return;
    }

    if (message.type === 'SALES_ROOM_QD_OPENED') {
      const currentStaff = await staffPromise;
      try {
        await recordSalesRoomActivity({
          action: 'QD_OPENED',
          customerId: message.customerId || ''
        });
      } catch (error) {
        // The QD file may still open even if activity logging is unavailable.
      }
      await refreshSalesActivity(currentStaff, 0);
      return;
    }

    if (message.type === 'SALES_ROOM_ACTIVITY_REQUEST') {
      const currentStaff = await staffPromise;
      await refreshSalesActivity(currentStaff, message.dayOffset || 0);
      return;
    }

    try {
      const response = await createSalesRoomCustomer(message.payload || {});
      const currentStaff = await staffPromise;
      if (response?.ok && response.customerId) {
        try {
          await recordSalesRoomActivity({
            action: 'CUSTOMER_CREATED',
            customerId: response.customerId
          });
        } catch (error) {
          // Activity logging must never block customer creation.
        }
        await refreshSalesActivity(currentStaff, 0);
      }
      salesRoom.postMessage({
        type: 'SALES_ROOM_CREATE_RESULT',
        ...response
      });
    } catch (error) {
      salesRoom.postMessage({
        type: 'SALES_ROOM_CREATE_RESULT',
        ok: false,
        error: error?.message || 'Customer creation failed.'
      });
    }
  });
});
