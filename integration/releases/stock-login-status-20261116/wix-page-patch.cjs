const stockReadStatus=`async function stockReadStatus(error) {
  let timeout;
  try {
    const member = await Promise.race([
      currentMember.getMember(),
      new Promise(resolve => { timeout = setTimeout(() => resolve(null), 2500); })
    ]);
    if (member === undefined) return 'SIGN_IN_REQUIRED';
    if (!member?._id) return 'SESSION_UNCONFIRMED';
    return [error?.status, error?.statusCode, error?.httpStatus].includes(403)
      ? 'ACCESS_DENIED' : 'READ_UNAVAILABLE';
  } catch (_) {
    return 'SESSION_UNCONFIRMED';
  } finally {
    clearTimeout(timeout);
  }
}`;
const version='20261116-stock-login-status-v1';
const methods={
  warehouse:{
    hash:'7809e57a51e69128485f0c7b986e3972390018bb6cff7261b98cb233a7581a77',
    oldBuild:'20261116-warehouse-receipt-confirmation-v1',
    before:"requestId:message.requestId,ok:false,error:error?.message||'Stock could not be read. 库存读取未完成。'"
  },
  finance:{
    hash:'b13be819d97fe60021553b9b3f632bfae6a32f100c249e2d8d3ba6022a8b7191',
    oldBuild:'20261116-finance-receipt-confirmation-v1',
    before:"requestId:message.requestId,ok:false,error:'Stock could not be confirmed. Refresh the stock list or check your Finance access.'"
  }
};
module.exports={version,stockReadStatus,methods};
