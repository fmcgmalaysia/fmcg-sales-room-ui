const assert = require('node:assert/strict');

module.exports = function patchWarehousePhotoProgress(source) {
  const queue = 'draft:{photos:evidence.slice(index,index+3)},packet:null,uncertain:false';
  const receipt = "state.queue.shift();state.notice='Saved 保存成功';notify(state.company,saved);";
  assert.equal(source.split(queue).length, 2, 'Expected the published photo queue');
  assert.equal(source.split(receipt).length, 2, 'Expected the published delivery receipt');

  return source
    .replace(queue, 'draft:{photos:evidence.slice(index,index+3)},photoProgress:{confirmed:Math.min(index+3,evidence.length),total:evidence.length},packet:null,uncertain:false')
    .replace(receipt, `state.queue.shift();
    const progress=command.photoProgress;
    if(!progress)state.notice='Saved 保存成功';
    else if(progress.confirmed<progress.total)state.notice='Photos confirmed '+progress.confirmed+'/'+progress.total+' · Uploading… 正在保存';
    else state.notice='All '+progress.total+' photos saved 照片已全部保存';
    notify(state.company,saved);`);
};
