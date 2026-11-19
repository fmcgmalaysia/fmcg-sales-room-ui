// Only for the two independently identified Wix QA sites.
const qaSites = Object.freeze({
  fmcg: Object.freeze({
    siteId: '17c4d74e-dbbe-43dd-959a-ddad1b9ca2f2',
    base: 'https://fmcg999.wixstudio.com/my-site-1'
  }),
  ltpos: Object.freeze({
    siteId: '43479a96-2b43-46c9-93b3-2f0c3d0c41a5',
    base: 'https://fmcg999.wixstudio.com/ltpos-desk-test'
  })
});

const routes = Object.freeze({
  staffAccess: { from: 'fmcg', to: 'ltpos' },
  nctIntake: { from: 'fmcg', to: 'ltpos' },
  qaQuoteSelection: { from: 'ltpos', to: 'fmcg' },
  qaQuotePublish: { from: 'ltpos', to: 'fmcg' }
});

function qaRoute(name, sourceSiteId, receiverSiteId, receiverBase) {
  if (!Object.hasOwn(routes, name)) throw Error('Unknown Wix QA route.');
  const route = routes[name];
  const source = qaSites[route.from];
  const receiver = qaSites[route.to];
  if (sourceSiteId !== source.siteId || receiverSiteId !== receiver.siteId || receiverBase !== receiver.base) {
    throw Error('Unverified Wix QA site pair.');
  }
  return `${receiver.base}/_functions/${name}?rc=test-site`;
}

module.exports = { qaSites, qaRoute };
