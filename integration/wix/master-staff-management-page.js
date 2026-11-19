import { getManagedStaffDirectory, getManagedStaffSaveStatus, registerPendingStaff, updateManagedStaff, getManagedCustomerDirectory } from 'backend/staffManagement.web';
import { authentication } from 'wix-members-frontend';

const FRAME_URL = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/master-staff/?v=20261119-staff-workspace-permissions-v1';
const rejectedSave = /^(Another employee change is being confirmed\.|Employee details changed\.|Employee identity could not be confirmed\.|Administrator identity cannot be changed here\.|Enter a valid staff name and email\.|This (?:email|staff identity) is already registered\.|Invalid (?:staff permissions|access scope|department permission|Support view scope|company permission|Sales Room permission|Sales Room function|customer permission|customer work permission|quotation permission|performance permission|employee status|employee save request)\.|Unknown staff permission\.|Support department permission is required\.|Choose the Sales Room function and access together\.|Super Admin access is required\.|Staff access is not authorized\.|Sign in with your approved staff account\.)/;

$w.onReady(() => {
  const frame = $w('#html1');
  frame.onMessage(async ({ data }) => {
    if (!data || typeof data.requestId !== 'string' || data.requestId.length > 80) return;
    if (!['LIST_STAFF', 'REGISTER_STAFF', 'UPDATE_STAFF', 'CHECK_STAFF_SAVE', 'LIST_CUSTOMERS', 'SIGN_IN'].includes(data.action)) return;
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
      if (data.action === 'CHECK_STAFF_SAVE') {
        if (typeof data.saveRequestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.saveRequestId)) return;
        const saveStatus = await getManagedStaffSaveStatus(data.saveRequestId);
        frame.postMessage({ ...reply, ok: true, saveStatus });
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
      const message = error?.message || 'Staff request failed.';
      const saveRejected = ['REGISTER_STAFF', 'UPDATE_STAFF'].includes(data.action) && rejectedSave.test(message);
      frame.postMessage({ ...reply, ok: false, error: message, saveRejected });
    }
  });
  frame.src = FRAME_URL;
});
