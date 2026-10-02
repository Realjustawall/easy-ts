const $=id=>document.getElementById(id);let current={},dirty=false,saving=false,audioUrl=null;
async function send(type,values={}){const r=await chrome.runtime.sendMessage({type,...values});if(!r?.ok)throw new Error(r?.error||'پاسخ افزونه دریافت نشد.');return r;}
function error(text){$('settingsError').textContent=text||'';$('settingsError').hidden=!text;}
function render(){
  for(const group of EasyTsSettings.groups){
    const link=document.createElement('a');link.href=`#${group.id}`;link.textContent=group.title;$('sectionNav').append(link);
    const section=document.createElement('section');section.className='surface';section.id=group.id;
    const h=document.createElement('h2');h.textContent=group.title;const p=document.createElement('p');p.textContent=group.description;
    const fields=document.createElement('div');fields.className='fields';section.append(h,p,fields);
    for(const f of group.fields){
      const label=document.createElement('label');label.className=`field${f.wide?' wide':''}`;label.htmlFor=f.key;
      const title=document.createElement('span');title.textContent=f.label;label.append(title);
      const input=document.createElement(['lines','textarea'].includes(f.type)?'textarea':f.type==='select'?'select':'input');input.id=f.key;input.dataset.setting=f.key;
      if(input.tagName==='INPUT')input.type=f.type;
      if(f.type==='select')for(const [value,title] of f.options)input.append(new Option(title,value));
      if(f.type==='number'){input.min=f.min;input.max=f.max;input.step=f.step;}
      if(f.maxLength)input.maxLength=f.maxLength;
      if(['text','password','number','lines'].includes(f.type)&&!['projectNotes'].includes(f.key))input.classList.add('latin');
      if(f.type==='password'||f.key==='fishApiKeys')input.autocomplete='off';
      if(f.suggestions){const list=document.createElement('datalist');list.id=`${f.key}-models`;for(const value of f.suggestions)list.append(new Option(value));input.setAttribute('list',list.id);label.append(list);}
      if(f.type==='password'){
        const row=document.createElement('div');row.className='secret-row';const button=document.createElement('button');button.type='button';button.textContent='نمایش';button.setAttribute('aria-label',`نمایش ${f.label}`);
        button.onclick=()=>{input.type=input.type==='password'?'text':'password';button.textContent=input.type==='password'?'نمایش':'پنهان';};row.append(input,button);label.append(row);
      }else label.append(input);
      if(f.help){const help=document.createElement('small');help.id=`${f.key}-help`;help.textContent=f.help;input.setAttribute('aria-describedby',help.id);label.append(help);}fields.append(label);
    }
    $('sections').append(section);
  }
  const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){document.querySelectorAll('#sectionNav a').forEach(a=>a.classList.toggle('active',a.hash===`#${e.target.id}`));}},{rootMargin:'-15% 0px -65% 0px'});
  document.querySelectorAll('#sections section').forEach(s=>observer.observe(s));
}
function routingNotice(){const s={ttsProvider:$('ttsProvider').value,ttsAutoSelect:$('ttsAutoSelect').checked,fishApiKeys:$('fishApiKeys').value.split('\n'),elevenApiKey:$('elevenApiKey').value,geminiApiKey:$('geminiApiKey').value,openaiApiKey:$('openaiApiKey').value};const names={fish:'Fish Audio',elevenlabs:'ElevenLabs',gemini:'Gemini',openai:'OpenAI',local:'مدل محلی'};let note=$('ttsResolved');if(!note){note=document.createElement('p');note.id='ttsResolved';note.setAttribute('role','status');$('ttsProvider').closest('.fields').after(note);}note.textContent=`سرویس TTS برای این تنظیمات: ${names[EasyTsProviders.tts(s)]} · تغییرات پس از ذخیره اعمال می‌شوند.`;}
function fill(values){for(const f of EasyTsSettings.groups.flatMap(g=>g.fields)){const input=$(f.key),v=values[f.key];if(v===undefined)continue;if(f.type==='checkbox')input.checked=v;else input.value=f.type==='lines'?v.join('\n'):v;}routingNotice();}
function collect(){const values={};for(const f of EasyTsSettings.groups.flatMap(g=>g.fields)){const input=$(f.key);values[f.key]=f.type==='checkbox'?input.checked:f.type==='number'||f.key==='ttsBitrate'?Number(input.value):f.type==='lines'?input.value.split(/\r?\n/):input.value;}values.fishApiKeys=values.fishApiKeys.filter(x=>x.trim());return EasyTsSettings.validate(values);}
function markDirty(){routingNotice();dirty=true;$('dirtyState').textContent='تغییرات ذخیره نشده‌اند';$('saveState').textContent='در انتظار ذخیره';}
async function save(event){event?.preventDefault();if(saving)return;saving=true;$('saveSettings').disabled=true;error('');try{const values=collect();current=(await send('EASYTS_SETTINGS_SET',{settings:values})).settings;fill(current);dirty=false;$('dirtyState').textContent='همهٔ تغییرات ذخیره شدند';$('saveState').textContent='ذخیره شد';}catch(e){error(e.message);}finally{saving=false;$('saveSettings').disabled=false;}}
async function test(type){error('');if(dirty){error('ابتدا تغییرات تنظیمات را ذخیره کنید.');return;}$('testTts').disabled=$('testTranslation').disabled=true;$('testResult').textContent='در حال ارسال درخواست…';try{const r=await send('EASYTS_PROVIDER_TEST',{kind:type,text:$('testText').value});if(type==='tts'){if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(new Blob([Uint8Array.from(atob(r.audio),c=>c.charCodeAt(0))],{type:r.mime}));$('testAudio').src=audioUrl;$('testAudio').hidden=false;await $('testAudio').play().catch(()=>{});$('testResult').textContent='نمونهٔ صدا آماده است.';}else $('testResult').textContent=r.text;}catch(e){error(e.message);$('testResult').textContent='درخواست ناموفق بود.';}finally{$('testTts').disabled=$('testTranslation').disabled=false;}}
render();$('settingsForm').addEventListener('submit',save);$('settingsForm').addEventListener('input',e=>{if(e.target.dataset.setting)markDirty();});$('settingsForm').addEventListener('change',e=>{if(e.target.dataset.setting)markDirty();});
$('testTts').onclick=()=>test('tts');$('testTranslation').onclick=()=>test('translation');
$('exportSettings').onclick=()=>{try{const values=collect();delete values.fishApiKeys;for(const key of Object.keys(values))if(/ApiKey$/.test(key))delete values[key];const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,settings:values},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='easy-ts-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){error(e.message);}};
$('importSettings').onchange=async()=>{try{const file=$('importSettings').files[0];if(!file)return;if(file.size>100000)throw new Error('فایل تنظیمات بیش از حد بزرگ است.');const data=JSON.parse(await file.text());if(data.version!==1||!data.settings||typeof data.settings!=='object')throw new Error('ساختار فایل تنظیمات معتبر نیست.');const values={...data.settings};delete values.fishApiKeys;for(const key of Object.keys(values))if(/ApiKey$/.test(key))delete values[key];const valid=EasyTsSettings.validate(values);fill(valid);markDirty();error('');}catch(e){error(e.message);}finally{$('importSettings').value='';}};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});window.addEventListener('unload',()=>{if(audioUrl)URL.revokeObjectURL(audioUrl);});
send('EASYTS_SETTINGS_GET').then(r=>{current=r.settings;fill(current);$('saveState').textContent='تنظیمات دریافت شد';}).catch(e=>{error(e.message);$('saveState').textContent='دریافت ناموفق';$('saveSettings').disabled=true;});
