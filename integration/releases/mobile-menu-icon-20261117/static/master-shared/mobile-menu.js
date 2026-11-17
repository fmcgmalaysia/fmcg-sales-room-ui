// Presentation only. Existing navigation buttons, identities and company handlers stay in place.
(()=>{
 const header=document.querySelector('[data-touch-menu-button],body>header.purchase-header,body>header.department-header');
 if(!header)return;
 const nav=document.querySelector('[data-touch-menu-panel]')||header.nextElementSibling;
 if(!nav||(!nav.hasAttribute('data-touch-menu-panel')&&nav.tagName!=='NAV'))return;
 const toggle=document.createElement('button');
 toggle.type='button';
 toggle.className='mobile-menu-toggle';
 nav.id=nav.id||'mobileDepartmentNavigation';
 toggle.setAttribute('aria-controls',nav.id);
 toggle.setAttribute('aria-label','Menu');
 const icon=document.createElement('span');
 icon.className='mobile-menu-icon';
 icon.setAttribute('aria-hidden','true');
 toggle.append(icon);
 header.append(toggle);
 document.body.classList.add('touch-menu-ready');
 const media=matchMedia('(max-width:1023px)');
 let expanded=false;
 function set(open){
  expanded=media.matches&&open;
  header.classList.toggle('mobile-menu-open',expanded);
  document.body.classList.toggle('touch-menu-open',expanded);
  toggle.setAttribute('aria-expanded',String(expanded));
  nav.inert=media.matches&&!expanded;
 }
 function close(restoreFocus){
  if(expanded)for(const details of nav.querySelectorAll('details[open]'))details.open=false;
  set(false);
  if(restoreFocus)toggle.focus();
 }
 toggle.addEventListener('click',()=>set(!expanded));
 nav.addEventListener('click',event=>{
  const target=event.target.closest('button,a[href]');
  if(!expanded||!target||target.hasAttribute('aria-expanded'))return;
  close(event.detail===0);
 });
 document.addEventListener('pointerdown',event=>{
  if(expanded&&!header.contains(event.target)&&!nav.contains(event.target))close(false);
 });
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&expanded&&!event.defaultPrevented)close(true);
 });
 media.addEventListener('change',()=>set(false));set(false);
})();
