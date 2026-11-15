const assert = require('node:assert/strict');

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, () => after);
}

const startSave = "    if(!command.packet){if(!list||command.action!=='DESK_PHOTOS'";
const clearUnsentBatch = `    if(command.action==='DESK_PHOTOS'&&!command.packet&&!list){
     state.queue=state.queue.filter(row=>row.action!=='DESK_PHOTOS'||row.listId!==command.listId);
     const confirmed=command.photoProgress.confirmed-command.draft.photos.length;
     state.notice='Desk no longer available. '+confirmed+'/'+command.photoProgress.total+' photos confirmed. Reopen the correct Desk before selecting the remaining photos again. 原任务已不可用，请重新打开正确的任务后再选择尚未保存的照片。';
     return;
    }
`;

module.exports = {
  'master-shared/desk-delivery.js': source => replaceOnce(source, startSave, clearUnsentBatch + startSave),
  'warehouse-room/index.html': source => replaceOnce(source,
    'desk-delivery.js?v=20261115-warehouse-photo-progress-v1',
    'desk-delivery.js?v=20261115-warehouse-unsent-photo-queue-v1'),
};
