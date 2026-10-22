(function(){
  const header=document.querySelector('[data-home-navigation]');if(!header)return;
  const button=header.querySelector('.home-menu-toggle'),nav=header.querySelector('nav');
  const links=Array.from(nav.querySelectorAll('a'));
  button.hidden=false;
  function close(){header.classList.remove('menu-open');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Open navigation');button.querySelector('span').textContent='menu';}
  function mark(link){links.forEach(item=>{item.classList.toggle('is-current',item===link);if(item===link)item.setAttribute('aria-current','location');else item.removeAttribute('aria-current');});}
  button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';if(!open){close();return;}header.classList.add('menu-open');button.setAttribute('aria-expanded','true');button.setAttribute('aria-label','Close navigation');button.querySelector('span').textContent='close';});
  links.forEach(link=>link.addEventListener('click',()=>{mark(link);close();const target=document.querySelector(link.getAttribute('href'));if(target){target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}}));
  header.addEventListener('keydown',event=>{if(event.key==='Escape'){close();button.focus();}});
  document.addEventListener('click',event=>{if(!header.contains(event.target))close();});
  window.addEventListener('resize',()=>{if(window.innerWidth>760)close();mark(links.find(link=>link.classList.contains('is-current'))||links[0]);});
  mark(links[0]);
  if(document.fonts)document.fonts.ready.then(()=>mark(links.find(link=>link.classList.contains('is-current'))||links[0]));
})();
