window.JYYR={...(window.JYYR||{}),formatIDR:(n)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n||0))};
const themeRoot=document.documentElement;
const themeStorageKey='jyyr-store-theme';

function applyTheme(theme,persist=false){
  if(theme!=='light'&&theme!=='dark')return;

  themeRoot.dataset.theme=theme;

  const themeColor=document.querySelector('meta[name="theme-color"]');
  if(themeColor){
    themeColor.content=theme==='light'?'#FFFFFF':'#090F16';
  }

  const label=theme==='light'
    ? 'Theme Mode (Light)'
    : 'Theme Mode (Dark)';

  document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
    button.setAttribute('aria-label',label);
    button.setAttribute('title',label);
    button.setAttribute('aria-pressed',String(theme==='light'));

    const status=button.querySelector('[data-theme-label]');
    if(status)status.textContent=label;
  });

  if(persist){
    try{
      window.localStorage.setItem(themeStorageKey,theme);
    }catch(_){
      // Theme remains active for this page even when storage is unavailable.
    }
  }
}

applyTheme(themeRoot.dataset.theme==='light'?'light':'dark');

document.addEventListener('click',(e)=>{
  const homeCategoryFilter=e.target.closest('[data-home-category-filter]');
  if(homeCategoryFilter){
    const homePage=homeCategoryFilter.closest('.home-page');
    const filterBar=homeCategoryFilter.closest('.home-category-filters');
    if(!homePage||!filterBar)return;

    const selectedCategory=homeCategoryFilter.dataset.homeCategoryFilter;

    filterBar.querySelectorAll('[data-home-category-filter]').forEach(button=>{
      const active=button===homeCategoryFilter;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-pressed',String(active));
    });

    homePage.querySelectorAll('[data-home-category-group]').forEach(group=>{
      group.hidden=
        selectedCategory!=='all' &&
        group.dataset.homeCategoryGroup!==selectedCategory;
    });

    return;
  }

  const themeToggle=e.target.closest('[data-theme-toggle]');
  if(themeToggle){
    applyTheme(themeRoot.dataset.theme==='light'?'dark':'light',true);
    return;
  }

  const logout=e.target.closest('[data-logout]');
  if(logout){
    e.preventDefault();
    JYYRApi.request('/api/auth/logout',{method:'POST'})
      .then(()=>location.href='/')
      .catch(err=>window.JYYRToast?.error(err.message));
  }
});
document.addEventListener('error',e=>{const img=e.target;if(img?.matches?.('[data-image-fallback]')){img.hidden=true;img.nextElementSibling?.removeAttribute('hidden');if(img.matches('.detail-image'))document.querySelector('[data-product-image-open]')?.setAttribute('hidden','')} if(img?.matches?.('[data-image-fallback-hide]'))img.hidden=true;},{capture:true});

document.addEventListener('contextmenu',(e)=>{
  const target=e.target.closest('a,button,img,svg,video,[role="button"]');
  if(target)e.preventDefault();
},true);
