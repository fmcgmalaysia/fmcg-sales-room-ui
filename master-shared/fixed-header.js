/* Presentation only: retain the existing header, navigation and their handlers. */
(()=>{
 const header=document.querySelector('body>header.purchase-header,body>header.department-header');
 const nav=header?.nextElementSibling;
 if(!header||nav?.tagName!=='NAV')return;
 const measure=()=>{
  document.documentElement.style.setProperty('--master-header-height',header.getBoundingClientRect().height+'px');
  document.documentElement.style.setProperty('--master-nav-height',nav.getBoundingClientRect().height+'px');
 };
 measure();
 if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(measure);observer.observe(header);observer.observe(nav);}
 else window.addEventListener('resize',measure);
})();
