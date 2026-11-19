const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const BUILD='20261119-staff-workspace-permissions-v1';
function patchSales(source){
  assert.equal(createHash('sha256').update(source).digest('hex'),'145a49418361d80e42c32ba684f2d23a619f764e4f9338a0c618a76deea4c5e6');
  const before="staff.canViewAllCustomers?'All Assigned Staff And Customer Records Are Visible.':'Only Assigned Customers Are Visible.'";
  assert.equal(source.split(before).length,2);
  return source.replace(before,"staff.canViewAllCustomers?'All Assigned Staff And Customer Records Are Visible.':staff.canBrowseAllCustomers?'All Customers Are Visible. Only Your Authorized Actions Are Available.':'Only Assigned Customers Are Visible.'")
    .replace('<head>','<head>\n<meta name="staff-permission-build" content="'+BUILD+'">');
}
module.exports={patchSales,BUILD};
