function rememberCosts() { writeStorage('cost-reads:' + staffId, [...costAttempts.entries()]); }
function costButtonState() {
  const button = $('#catch-cost');
  if (!button || !current) return;
  const running = costAttempts.has(customerId());
  button.disabled = running || publishingRows.size > 0 || !current.canEdit || !current.rows.length;
  button.textContent = running ? 'Refreshing cost…' : 'Catch Cost';
}
function paintCostReferences(updates, context) {
  if (!current || current.customer.customerId !== context || customerId() !== context) return;
  const costs = new Map(updates.map(row => [row.id, row]));
  for (const row of current.rows) {
    const cost = costs.get(row.id);
    if (!cost) continue;
    if (cost.costAt && row.costAt && cost.costAt < row.costAt) continue;
    // Never overwrite a price, revision, publication receipt or another row's edit.
    for (const name of ['costMyr', 'costAt', 'costDetails', 'costError']) {
      if (Object.prototype.hasOwnProperty.call(cost, name)) row[name] = cost[name];
    }
  }
  for (const tr of content.querySelectorAll('tr[data-row]')) {
    const row = current.rows.find(item => item.id === tr.dataset.row);
    if (!row || !costs.has(row.id)) continue;
    const fragment = document.createElement('template');
    fragment.innerHTML = '<table><tbody>' + quoteRow(row, 1) + '</tbody></table>';
    const fresh = fragment.content.querySelector('tr');
    for (const index of [6, 7, 8, 9]) tr.cells[index].innerHTML = fresh.cells[index].innerHTML;
    tr.querySelector('[data-profit]').innerHTML = profit(sellingPrice(row));
    const target = calculatorInput(row), suggestion = target ? calculatorPrice(row, target) : null;
    tr.querySelector('[data-calculated-selling]').value = suggestion ? fixed(suggestion.priceEa) : '0.00';
    updateCalculatorApply(row, tr, sellingPrice(row), suggestion);
    if (!publishingRows.has(row.id) && !row.pending) {
      const toggle = tr.querySelector('[data-action=toggle]');
      toggle.disabled = current.canPublish === false || !current.canEdit || (!row.published?.enabled && !Number.isFinite(sellingPrice(row)?.gp));
    }
  }
  const latest = current.rows.reduce((at, row) => row.costAt > at ? row.costAt : at, '');
  const label = content.querySelector('[data-cost-refresh]');
  if (label) label.textContent = 'Last Cost Refresh  ' + (quoteDate(latest, true) || '—');
  const risk = riskCount();
  $('#quote-risk-count').textContent = risk;
  $('#quote-risk-count').classList.toggle('gp-risk', Boolean(risk));
}
async function confirmCostRead(context, start = false) {
  if (costReaders.has(context) || !current || !staffId) return;
  let packet = costAttempts.get(context);
  if (!packet) {
    if (!start) return;
    packet = { requestId: requestId() };
    costAttempts.set(context, packet); rememberCosts();
  }
  costReaders.add(context);
  costButtonState();
  let first = start, delay = 1500;
  try {
    while (costAttempts.get(context) === packet && current && current.customer.customerId === context) {
      if (customerId() === context) message(first ? 'Refreshing cost references…' : 'Confirming cost refresh automatically. You can continue editing.');
      let result;
      try { result = await api(first ? 'cost' : 'cost-status', packet, context); }
      catch {
        if (!current) return;
        result = { pending: true };
      }
      first = false;
      if (!result.pending) {
        let updates = result.rows;
        if (!updates) {
          const refreshed = await api('quotes', undefined, context);
          if (refreshed.staffId !== staffId || refreshed.customer?.customerId !== context) throw Error('Cost reference scope changed.');
          updates = refreshed.rows;
        }
        paintCostReferences(updates, context);
        costAttempts.delete(context); rememberCosts();
        if (customerId() === context) {
          const success = result.updated + result.unchanged;
          message(`Catch Cost: ${result.updated} updated · ${result.unchanged} unchanged · ${result.failed} unavailable.`,
            result.failed > 0 && success === 0, result.failed > 0 && success > 0);
        }
        return;
      }
      // Cost capture is now a source read with zero CMS writes. If its temporary
      // result was evicted, repeating that same read cannot alter prices/orders.
      first = result.missing === true;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(15000, delay * 1.5);
    }
  } catch {
    if (customerId() === context) message('Cost confirmation will continue automatically. Your quotations are retained.');
    setTimeout(() => confirmCostRead(context), 15000);
  } finally {
    costReaders.delete(context);
    costButtonState();
  }
}
