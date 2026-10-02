/* Shared navigation and appearance for the extension's full-page tools. */
(() => {
  const page = document.body.dataset.page;
  if (!page) return;
  const icon = name => `<img class="ui-icon" src="icons/ui/${name}.svg" alt="" width="20" height="20">`;
  const links = [ ['dashboard','dashboard.html','layout-dashboard','داشبورد'], ['studio','studio.html','headphones','استودیوی دوبله'], ['live','live.html','microphone','ترجمهٔ زنده'], ['settings','settings.html','adjustments','تنظیمات کامل'] ];
  const sidebar = document.createElement('aside');
  sidebar.className = 'workspace-sidebar';
  sidebar.innerHTML = `<a class="workspace-brand" href="dashboard.html"><span class="workspace-logo">E</span><span dir="ltr">Easy-ts<small>TRANSLATION WORKSPACE</small></span></a><span class="nav-caption">فضای کار</span><nav aria-label="صفحه‌های افزونه">${links.map(([id,url,glyph,label])=>`<a href="${url}" ${page===id?'aria-current="page"':''}>${icon(glyph)}<span>${label}</span>${page===id?'<span class="nav-active-mark"></span>':''}</a>`).join('')}</nav><div class="sidebar-guide"><span class="guide-icon">${icon('wave-sine')}</span><strong>صدای تو، به زبان دیگر.</strong><p>فایل را وارد کن، ترجمه را بازبینی کن و دوبله را تحویل بگیر.</p><a href="studio.html">ساخت پروژه ${icon('arrow-up-right')}</a></div><div class="sidebar-bottom"><button id="workspaceTheme" type="button">${icon('sun')}<span>نمای روشن</span></button><span class="local-storage-note">پروژه‌ها در همین مرورگر ذخیره می‌شوند</span></div>`;
  document.body.prepend(sidebar);
  const skip=document.createElement('a');skip.className='workspace-skip';skip.href='#workspaceContent';skip.textContent='رفتن به محتوای صفحه';document.body.prepend(skip);
  document.querySelector('main')?.setAttribute('id','workspaceContent');
  const toggle=sidebar.querySelector('#workspaceTheme');
  let theme='dark';try{theme=localStorage.getItem('easyts-theme')||'dark';}catch{}
  function applyTheme(){document.documentElement.dataset.theme=theme;toggle.querySelector('span').textContent=theme==='dark'?'نمای روشن':'نمای تیره';toggle.querySelector('img').src=`icons/ui/${theme==='dark'?'sun':'moon'}.svg`;toggle.setAttribute('aria-label',theme==='dark'?'تغییر به نمای روشن':'تغییر به نمای تیره');}
  applyTheme();toggle.onclick=()=>{theme=theme==='dark'?'light':'dark';applyTheme();try{localStorage.setItem('easyts-theme',theme);}catch{}};
  if(page==='dashboard'){
    const panel=document.createElement('aside');panel.className='dashboard-controls';
    for(const selector of ['.speaker-summary','.actions','#exportSrtBtn','.sync-note'])panel.append(document.querySelector(`#tab-dub ${selector}`));
    document.getElementById('tab-dub').append(panel);
  }
  if(page==='settings'){
    const search=document.createElement('div');search.className='settings-search';
    const label=document.createElement('label');label.htmlFor='settingsSearch';label.textContent='جست‌وجو در تنظیمات';
    const input=document.createElement('input');input.type='search';input.id='settingsSearch';input.placeholder='نام سرویس، مدل، صدا یا تنظیم موردنظر…';
    const result=document.createElement('span');result.setAttribute('role','status');result.setAttribute('aria-live','polite');
    search.append(label,input,result);document.getElementById('sections').before(search);
    input.addEventListener('input',()=>{
      const query=input.value.trim().toLocaleLowerCase();let matches=0;
      for(const section of document.querySelectorAll('#sections>.surface')){
        const groupMatch=section.querySelector('h2').textContent.toLocaleLowerCase().includes(query);
        let visible=0;
        for(const field of section.querySelectorAll('.fields>.field')){
          field.hidden=!!query&&!groupMatch&&!field.textContent.toLocaleLowerCase().includes(query)&&!field.querySelector('[data-setting]')?.id.toLocaleLowerCase().includes(query);
          if(!field.hidden)visible++;
        }
        section.hidden=!visible;matches+=visible;
      }
      result.textContent=query?(matches?`${new Intl.NumberFormat('fa-IR').format(matches)} تنظیم پیدا شد`:'تنظیمی با این عبارت پیدا نشد'):'';
    });
    for(const link of document.querySelectorAll('#sectionNav a'))link.addEventListener('click',()=>{input.value='';input.dispatchEvent(new Event('input'));});
  }
})();
