import { createSalesRoomCustomer, verifySalesRoomCustomerQd, getSalesRoomCustomers, getSalesRoomCustomerDetail, getAssignableSalesStaff, updateSalesRoomCustomerProfile, updateSalesRoomSelectionLimit, saveSalesRoomCustomerUser, getSalesRoomCustomerAudit, recordSalesRoomActivity, getSalesRoomActivityForAdmin, getSalesRoomCustomersOperational, getSalesRoomConfirmedOrders, getSalesRoomOrderDetail, getSalesRoomOrderForm, submitSalesRoomOrder, createSalesRoomProforma, confirmSalesRoomOrderForm, updateSalesRoomCustomerLifecycle, addSalesRoomCustomerUser, reviewSalesRoomCustomerUser, publishSalesRoomQuotations, getSalesRoomOrderProgress, saveSalesRoomOrderQty, saveSalesRoomOrderPo } from 'backend/onboarding.web';
import { getFxRateSettings, saveAndSyncFxRates } from 'backend/fxRates.web';
import { getCurrentStaffContext, recordStaffPresence, getStaffPresenceForAdmin } from 'backend/staffAuth.web';
import { getSalesRoomQuoteSignals, processSalesRoomSelectionQueue, routeSalesRoomCustomerSelections } from 'backend/catalogueSelection.web';
import wixLocationFrontend from 'wix-location-frontend';
import { authentication } from 'wix-members-frontend';
import wixRealtimeFrontend from 'wix-realtime-frontend';

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

async function getSalesRoomCustomersWithQuoteSignals() {
  const response = await getSalesRoomCustomersOperational();
  try {
    const signals = await getSalesRoomQuoteSignals();
    const byCustomer = signals?.byCustomer || {};
    const customers = (Array.isArray(response?.customers) ? response.customers : []).map((customer) => ({
      ...customer,
      ...(byCustomer[String(customer?.customerId || '').trim()] || {})
    }));
    const quoteSummary = signals?.summary || {};
    return {
      ...response,
      customers,
      summary: {
        ...(response?.summary || {}),
        awaitingQuoteItemCount: Number(quoteSummary.awaitingQuoteItemCount || 0),
        quotedItemCount: Number(quoteSummary.quotedItemCount || 0),
        failedQuoteItemCount: Number(quoteSummary.failedQuoteItemCount || 0),
        quoteCustomerCount: customers.filter((customer) => Number(customer.awaitingQuoteItemCount || 0) > 0).length
      }
    };
  } catch (error) {
    console.error('Quotation signals could not be loaded', error);
    return response;
  }
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
  salesRoom.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/?v=20261007-sales-soft-blue-review-room5-v1';
  const staffPromise = loadCurrentStaff();
  let currentDevice = 'UNKNOWN';
  let customerRefreshPromise;
  let routeQueuePromise;
  let automaticQdVerificationPromise;

  function verifyActivationRequiredQdsInBackground(customers) {
    if (automaticQdVerificationPromise) return automaticQdVerificationPromise;
    const pendingCustomers = (Array.isArray(customers) ? customers : [])
      .filter((customer) => String(customer?.qdStatus || '').trim().toUpperCase() === 'ACTIVATION_REQUIRED');
    if (!pendingCustomers.length) return Promise.resolve();

    automaticQdVerificationPromise = Promise.allSettled(
      pendingCustomers.map((customer) => verifySalesRoomCustomerQd(customer.customerId))
    )
      .then(() => getSalesRoomCustomersWithQuoteSignals())
      .then((response) => salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMERS', ...response }))
      .catch((error) => console.error('Automatic QD verification could not be completed', error))
      .finally(() => { automaticQdVerificationPromise = null; });
    return automaticQdVerificationPromise;
  }

  function refreshCustomersFromCms() {
    if (customerRefreshPromise) return customerRefreshPromise;
    customerRefreshPromise = getSalesRoomCustomersWithQuoteSignals()
      .then((response) => {
        salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMERS', ...response });
        verifyActivationRequiredQdsInBackground(response?.customers);
        return response;
      })
      .catch((error) => salesRoom.postMessage({ type: 'SALES_ROOM_CUSTOMERS', ok: false, error: error?.message || 'Customer List Could Not Be Loaded.' }))
      .finally(() => { customerRefreshPromise = null; });
    return customerRefreshPromise;
  }

  function routePendingSelections() {
    if (routeQueuePromise) return routeQueuePromise;
    routeQueuePromise = processSalesRoomSelectionQueue()
      .then((result) => {
        if (Number(result?.processed || 0) > 0) return refreshCustomersFromCms();
        return result;
      })
      .catch((error) => console.error('QD background queue could not be processed', error))
      .finally(() => { routeQueuePromise = null; });
    return routeQueuePromise;
  }

  wixRealtimeFrontend.subscribe({ name: 'sales-room-signals' }, async () => {
    await refreshCustomersFromCms();
    routePendingSelections();
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

  staffPromise.then((staff) => {
    if (!staff.authorized) {
      wixLocationFrontend.to(STAFF_LOGIN_URL);
    }
  });

  salesRoom.onMessage(async (event) => {
    const message = event.data || {};

    if (message.type === 'SALES_ROOM_OPEN_BUYER_ROOM') {
      const staff = await staffPromise;
      const customerId = String(message.customerId || '').trim();
      if (!staff.authorized || !/^CUS-[A-Za-z0-9-]+$/.test(customerId)) return;
      wixLocationFrontend.to('/buyer-room?assist=' + encodeURIComponent(customerId));
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
            canViewAllCustomers: staff.canViewAllCustomers
          }
        : {
            authorized: false,
            reason: staff.reason
          };

      salesRoom.postMessage({
        type: 'SALES_ROOM_STAFF',
        staff: safeStaff
      });

      if (staff.authorized) {
        try {
          await recordSalesRoomActivity({ action: 'SALES_ROOM_ENTER' });
        } catch (error) {
          // Activity logging must never block staff work.
        }
        await refreshSalesActivity(staff, 0);
        try {
          const routing = await getAssignableSalesStaff();
          salesRoom.postMessage({
            type: 'SALES_ROOM_ASSIGNABLE_STAFF',
            ...routing
          });
        } catch (error) {
          salesRoom.postMessage({
            type: 'SALES_ROOM_ASSIGNABLE_STAFF',
            ok: false,
            error: error?.message || 'Assignable staff could not be loaded.'
          });
        }

        try {
          const response = await getSalesRoomCustomersWithQuoteSignals();
          salesRoom.postMessage({
            type: 'SALES_ROOM_CUSTOMERS',
            ...response
          });
        } catch (error) {
          salesRoom.postMessage({
            type: 'SALES_ROOM_CUSTOMERS',
            ok: false,
            error: error?.message || 'Customer list could not be loaded.'
          });
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
          ...response
        });
      } catch (error) {
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_DETAIL',
          ok: false,
          error: error?.message || 'Customer detail could not be loaded.'
        });
      }
      return;
    }



    if (message.type === 'SALES_ROOM_CUSTOMERS_REQUEST') {
      await refreshCustomersFromCms();
      routePendingSelections();
      return;
    }

    if (message.type === 'SALES_ROOM_ROUTE_QD_REQUEST') {
      const customerId = message.customerId || '';
      try {
        const response = await routeSalesRoomCustomerSelections(customerId);
        salesRoom.postMessage({
          type: 'SALES_ROOM_QD_ROUTE_RESULT',
          customerId,
          ...response
        });
        await refreshCustomersFromCms();
      } catch (error) {
        salesRoom.postMessage({
          type: 'SALES_ROOM_QD_ROUTE_RESULT',
          ok: false,
          customerId,
          error: error?.message || 'Quotation Desk route could not be completed.'
        });
        await refreshCustomersFromCms();
      }
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
          ...response
        });
      } catch (error) {
        salesRoom.postMessage({
          type: 'SALES_ROOM_CUSTOMER_PROFILE_RESULT',
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


    if (message.type === 'SALES_ROOM_PUBLISH_QUOTES') {
      try {
        const result = await publishSalesRoomQuotations(message.customerId || '');
        salesRoom.postMessage({ type: 'SALES_ROOM_PUBLISH_QUOTES_RESULT', ok: true, result });
        await refreshCustomersFromCms();
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_PUBLISH_QUOTES_RESULT', ok: false, error: error?.message || 'Quotation publishing failed.' });
      }
      return;
    }

    if (message.type === 'SALES_ROOM_QD_OPENED') {
      const currentStaff = await staffPromise;
      try { await recordSalesRoomActivity({ action: 'QD_OPENED', customerId: message.customerId || '' }); } catch (error) {}
      await refreshSalesActivity(currentStaff, 0);
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
      try { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_DETAIL', ...(await getSalesRoomOrderDetail(message.orderId || '')) }); }
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
    if (message.type === 'SALES_ROOM_SUBMIT_ORDER') {
      try { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ...(await submitSalesRoomOrder(message.orderId || '', message.destination || '')) }); }
      catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ok: false, error: error?.message || 'Order could not be submitted.' }); }
      return;
    }
    if (message.type === 'SALES_ROOM_CREATE_PROFORMA') {
      try { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ...(await createSalesRoomProforma(message.orderId || '')) }); }
      catch (error) { salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ok: false, error: error?.message || 'Proforma request could not be created.' }); }
      return;
    }

    if (message.type === 'SALES_ROOM_QD_VERIFY') {
      try {
        const response = await verifySalesRoomCustomerQd(message.customerId || '');
        salesRoom.postMessage({ type: 'SALES_ROOM_QD_VERIFY_RESULT', ...response });
      } catch (error) {
        salesRoom.postMessage({ type: 'SALES_ROOM_QD_VERIFY_RESULT', ok: false, customerId: message.customerId || '', error: error?.message || 'Quotation Desk activation could not be verified.' });
      }
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
