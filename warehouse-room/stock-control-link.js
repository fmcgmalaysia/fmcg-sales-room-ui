// Open separately: never reload or discard a receiving/loading draft.
document.getElementById('openStockControl').addEventListener('click', () => {
  const company = document.getElementById('company').value;
  if (!['NCT', 'GHR'].includes(company)) return;
  window.open('https://fmcg999.wixstudio.com/master/stock-control?company=' + company, '_blank', 'noopener');
});
