// Presentation only. Existing navigation buttons, identities and company handlers stay in place.
(()=>{
 const header=document.querySelector('body>header.purchase-header,body>header.department-header'),nav=header?.nextElementSibling;
 if(!header||nav?.tagName!=='NAV')return;
 const toggle=document.createElement('button');toggle.type='button';toggle.className='mobile-menu-toggle';toggle.textContent='☰ Menu';
 nav.id=nav.id||'mobileDepartmentNavigation';toggle.setAttribute('aria-controls',nav.id);toggle.setAttribute('aria-expanded','false');header.append(toggle);
 const media=matchMedia('(max-width:600px)');
 function set(open){header.classList.toggle('mobile-menu-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'× Menu':'☰ Menu';nav.inert=media.matches&&!open;}
 toggle.addEventListener('click',()=>set(toggle.getAttribute('aria-expanded')!=='true'));
 nav.addEventListener('click',event=>{if(media.matches&&event.target.closest('button'))set(false);});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&media.matches&&toggle.getAttribute('aria-expanded')==='true'){set(false);toggle.focus();}});
 media.addEventListener('change',()=>set(false));set(false);
})();
