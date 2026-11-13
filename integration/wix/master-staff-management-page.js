import { getManagedStaffDirectory, getManagedStaffSaveStatus, registerPendingStaff, updateManagedStaff, getManagedCustomerDirectory } from 'backend/staffManagement.web';
import { authentication } from 'wix-members-frontend';

const FRAME_URL = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/master-staff/?v=master-staff-management-v2';

$w.onReady(() => {
  const frame = $w('#html1');
  frame.onMessage(async ({ data }) => {
    if (!data || typeof data.requestId !== 'string' || data.requestId.length > 80) return;
    if (!['LIST_STAFF', 'REGISTER_STAFF', 'UPDATE_STAFF', 'LIST_CUSTOMERS', 'SIGN_IN'].includes(data.action)) return;
    const reply = { type: 'MASTER_STAFF_RESULT', requestId: data.requestId };
    try {
      if (data.action === 'SIGN_IN') {
        if (!authentication.loggedIn()) await authentication.promptLogin({ mode: 'login', modal: true });
        frame.postMessage({ ...reply, ok: true });
        return;
      }
      if (!authentication.loggedIn()) {
        frame.postMessage({ ...reply, ok: false, signInRequired: true });
        return;
      }
      const rows = data.action === 'LIST_STAFF' ? await getManagedStaffDirectory() : undefined;
      const saveStatus = data.action === 'LIST_STAFF' ? await getManagedStaffSaveStatus() : undefined;
      const customers = data.action === 'LIST_CUSTOMERS' ? await getManagedCustomerDirectory() : undefined;
      const input = { requestId: data.saveRequestId, name: data.name, email: data.email, access: data.access,
        staffId: data.staffId, revision: data.revision, status: data.status };
      const employee = data.action === 'REGISTER_STAFF' ? await registerPendingStaff(input) :
        data.action === 'UPDATE_STAFF' ? await updateManagedStaff(input) : undefined;
      frame.postMessage({ ...reply, ok: true, rows, saveStatus, employee, customers });
    } catch (error) {
      frame.postMessage({ ...reply, ok: false, error: error?.message || 'Staff request failed.' });
    }
  });
  frame.src = FRAME_URL;
});
