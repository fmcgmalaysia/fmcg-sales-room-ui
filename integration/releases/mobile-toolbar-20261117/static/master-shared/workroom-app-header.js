(() => {
  const header = document.querySelector('body header[data-app-header-search]');
  if (!header) return;
  if (header.hasAttribute('data-app-header-stock') && document.documentElement.classList.contains('warehouse-embedded')) return;
  const media = matchMedia('(max-width:1023px)');
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'app-header-search';
  input.hidden = true;
  input.autocomplete = 'off';
  header.append(input);

  const companies = [...header.querySelectorAll('select option')].filter(option => /^(NCT|GHR)$/.test(option.value));
  const companyLabels = companies.map(option => option.getAttribute('label'));
  function syncCompanyLabels() {
    companies.forEach((option, index) => {
      if (media.matches) option.label = option.value;
      else if (companyLabels[index] === null) option.removeAttribute('label');
      else option.label = companyLabels[index];
    });
  }

  let source, sourceTabIndex;
  function sync() {
    const forced = header.dataset.appHeaderSearchForce;
    const next = media.matches
      ? [...document.querySelectorAll(header.dataset.appHeaderSearch)].find(element => !element.disabled && (element.getClientRects().length || forced && element.matches(forced)))
      : undefined;
    if (source !== next) {
      if (source) {
        source.classList.remove('app-header-search-source');
        if (sourceTabIndex === null) source.removeAttribute('tabindex');
        else source.setAttribute('tabindex', sourceTabIndex);
      }
      source = next;
      if (source) {
        sourceTabIndex = source.getAttribute('tabindex');
        source.tabIndex = -1;
        source.classList.add('app-header-search-source');
      }
    }
    input.hidden = !source;
    header.classList.toggle('app-header-has-search', Boolean(source));
    if (!source) return;
    input.setAttribute('aria-label', source.getAttribute('aria-label') || source.placeholder || 'Search');
    input.placeholder = header.dataset.appHeaderMobilePlaceholder || source.placeholder || 'Search';
    if (input.value !== source.value) input.value = source.value;
  }

  input.addEventListener('input', () => {
    if (!source?.isConnected || source.disabled) return;
    source.value = input.value;
    source.dispatchEvent(new Event('input', { bubbles: true }));
  });
  input.addEventListener('change', () => source?.dispatchEvent(new Event('change', { bubbles: true })));
  const region = document.querySelector(header.dataset.appHeaderSearchRegion);
  if (region) new MutationObserver(sync).observe(region, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'style', 'disabled'] });
  document.addEventListener('input', event => { if (event.target === source) sync(); });
  media.addEventListener('change', () => { syncCompanyLabels(); sync(); });
  syncCompanyLabels();
  sync();
})();
