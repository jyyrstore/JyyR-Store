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

  const nextTheme=theme==='light'?'dark':'light';
  const label=nextTheme==='light'
    ? 'Aktifkan mode terang'
    : 'Aktifkan mode gelap';

  document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
    button.setAttribute('aria-label',label);
    button.setAttribute('title',label);
    button.setAttribute('aria-pressed',String(theme==='light'));
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
document.addEventListener('contextmenu',(e)=>{
  const target=e.target.closest('a,button,img,svg,video,[role="button"]');
  if(target)e.preventDefault();
},true);
