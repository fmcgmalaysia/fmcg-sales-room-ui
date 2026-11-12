import { getManagedStaffDirectory, registerPendingStaff } from 'backend/staffManagement.web';

const FRAME_URL = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/master-staff/';

$w.onReady(() => {
  const frame = $w('#html1');
  frame.onMessage(async ({ data }) => {
    if (!data || typeof data.requestId !== 'string' || data.requestId.length > 80) return;
    if (data.action !== 'LIST_STAFF' && data.action !== 'REGISTER_STAFF') return;
    const reply = { type: 'MASTER_STAFF_RESULT', requestId: data.requestId };
    try {
      const rows = data.action === 'LIST_STAFF' ? await getManagedStaffDirectory() : undefined;
      const employee = data.action === 'REGISTER_STAFF' ?
        await registerPendingStaff({ name: data.name, email: data.email }) : undefined;
      frame.postMessage({ ...reply, ok: true, rows, employee });
    } catch (error) {
      frame.postMessage({ ...reply, ok: false, error: error?.message || 'Staff request failed.' });
    }
  });
  frame.src = FRAME_URL;
});
