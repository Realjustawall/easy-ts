(() => {
  const get=id=>document.getElementById(id);
  const number=new Intl.NumberFormat('fa-IR');
  const providers={fish:'Fish Audio',groq:'Groq',deepgram:'Deepgram',elevenlabs:'ElevenLabs',gemini:'Gemini',openai:'OpenAI',local:'مدل محلی',auto:'خودکار'};
  let timer,inFlight=false;
  async function updateOverview(){
    if(inFlight)return;inFlight=true;
    try {
      const results=await Promise.allSettled([StudioDB.all('jobs'),chrome.runtime.sendMessage({type:'EASYTS_SETTINGS_GET'}),chrome.runtime.sendMessage({type:'EASYTS_CACHE_STATS'})]);
      if(results[0].status==='fulfilled'){
        const jobs=results[0].value.sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
        get('dashProjectCount').textContent=number.format(jobs.length);
        get('dashSentenceCount').textContent=number.format(jobs.reduce((sum,j)=>sum+(j.segments||[]).filter(s=>s.ready).length,0));
        get('recentProjects').replaceChildren();
        if(!jobs.length){const p=document.createElement('p');p.className='project-list-empty';p.textContent='هنوز پروژه‌ای ندارید. برای شروع، یک فایل صوتی یا ویدئویی وارد کنید.';get('recentProjects').append(p);}
        for(const job of jobs.slice(0,4)){
          const row=document.createElement('a');row.className='recent-project';row.href=`studio.html?job=${encodeURIComponent(job.jobKey)}`;
          const glyph=document.createElement('span');glyph.className='project-glyph';const image=document.createElement('img');image.className='ui-icon';image.src='icons/ui/folder.svg';image.alt='';glyph.append(image);
          const copy=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small');title.textContent=job.title||'پروژهٔ بدون عنوان';meta.textContent=`${number.format(job.segments?.length||0)} جمله · ${job.sourceMode==='file'?'فایل واردشده':'YouTube'}`;copy.append(title,meta);
          const date=document.createElement('span');date.textContent=job.createdAt?new Intl.DateTimeFormat('fa-IR',{month:'short',day:'numeric'}).format(job.createdAt):'';
          const status=document.createElement('span');status.textContent=job.segments?.length&&job.segments.every(s=>s.ready)?'آمادهٔ خروجی':'ادامهٔ ویرایش ↗';row.append(glyph,copy,date,status);get('recentProjects').append(row);
        }
      }else{get('dashProjectCount').textContent='—';get('dashSentenceCount').textContent='—';get('recentProjects').textContent='دریافت پروژه‌ها ناموفق بود؛ صفحه را دوباره بارگذاری کنید.';}
      if(results[1].status==='fulfilled'&&results[1].value?.ok){const s=results[1].value.settings||{};get('dashProvider').textContent=providers[EasyTsProviders.tts(s)];get('dashVoiceMode').textContent=s.autoSpeakerVoices?'انتخاب صدا بر اساس گوینده':'صدای پیش‌فرض';get('dashStt').textContent=providers[s.sttProvider||'auto'];get('dashTranslation').textContent=providers[s.translationProvider||'groq'];}
      if(results[2].status==='fulfilled'&&results[2].value?.ok){const result=results[2].value,stats=result.stats||result;const bytes=stats.totalBytes??stats.bytes;get('dashCacheSize').textContent=Number.isFinite(bytes)?`${new Intl.NumberFormat('fa-IR',{maximumFractionDigits:1}).format(bytes/1024/1024)} MB`:'—';}
      else get('dashCacheSize').textContent='—';
    }catch(error){
      get('recentProjects').textContent='ارتباط با افزونه برقرار نیست؛ افزونه را نصب و این صفحه را دوباره باز کنید.';
      for(const id of ['dashProjectCount','dashSentenceCount','dashCacheSize','dashProvider'])get(id).textContent='—';
    }finally{inFlight=false;}
  }
  get('dashboardVideoTab').onchange=event=>{document.body.dataset.selectedTab=event.target.value;document.getElementById('reconnectBtn').click();};
  updateOverview();timer=setInterval(updateOverview,8000);window.addEventListener('unload',()=>clearInterval(timer));
})();
