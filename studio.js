const el = id => document.getElementById(id);
let project = null, status = {}, settings = {}, pageNumber = 0, poll, refreshing = false;
let localBusy = false, previewUrl = null, exportRecord = null, videoRecord = null;
const PAGE_SIZE = 30;
const busy = () => localBusy || ['starting','transcribing','translating','generating','capturing','exporting'].includes(status.phase);
async function message(type, values = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...values });
  if (!response?.ok) throw new Error(response?.error || 'پاسخ افزونه دریافت نشد.');
  return response;
}
function error(text) { el('studioError').textContent = String(text || ''); el('studioError').hidden = !text; }
async function act(button, work) {
  button.disabled = true; error('');
  try { await work(); } catch (e) { error(e.message); }
  finally { updateControls(); }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function updateControls() {
  const isBusy = busy(), hasProject = !!project?.segments.length, dirty = !!document.querySelector('.segment.dirty');
  el('processFileBtn').disabled = isBusy || !el('sourceFile').files?.length;
  el('restoreBtn').disabled = isBusy || !el('projectSelect').value;
  el('regenerateMissingBtn').disabled = isBusy || !hasProject || project.segments.every(s => s.ready) || project.segments.some(s => s.translated === false);
  el('renderAudioBtn').disabled = isBusy || dirty || !hasProject || project.segments.some(s => !s.ready);
  el('downloadAudioBtn').disabled = isBusy || dirty || !exportRecord || exportRecord.timelineVersion !== 2 || exportRecord.revision !== (project?.revision || 0);
  el('renderVideoBtn').disabled = isBusy || dirty || !project?.sourceKey || !exportRecord || exportRecord.timelineVersion !== 2 || exportRecord.revision !== (project?.revision || 0);
  el('downloadVideoBtn').disabled = isBusy || dirty || !videoRecord || videoRecord.timelineVersion !== 2 || videoRecord.revision !== (project?.revision || 0);
  el('exportSrtStudio').disabled = dirty || !hasProject || project.segments.some(s => s.translated === false);
  el('segments').querySelectorAll('button,input,textarea').forEach(node => {
    const segment = project?.segments.find(s => s.id === Number(node.closest('.segment')?.dataset.id));
    node.disabled = isBusy || (node.dataset.action === 'preview' && !segment?.ready);
  });
  el('refreshBtn').disabled = localBusy;
  for (const id of ['assignVoiceBtn','saveMixBtn','clearMixBtn','voiceSpeaker','speakerVoice','backgroundFile','backgroundGain','backgroundDuck']) el(id).disabled = isBusy || dirty || !hasProject;
  el('assignVoiceBtn').disabled ||= !el('voiceSpeaker').value;
  el('clearMixBtn').disabled ||= !project?.background;
}
function applyStatus(next) {
  status = next || {};
  el('projectTitle').textContent = status.title || project?.title || 'پروژه‌ای باز نیست';
  el('statusLabel').textContent = status.label || 'آماده';
  if (status.error) error(status.error);
  const p = EasyTsCore.progress(status);
  const percent = status.phase === 'exporting' ? status.exportPercent : p.overallPercent;
  el('studioPercent').textContent = percent == null ? '—' : `${percent}%`;
  el('studioProgress').value = percent || 0;
  el('stageLabel').textContent = status.phase === 'exporting' ? 'ساخت خروجی صوتی' : `ترجمه: ${p.translationPercent ?? '—'}% · صدا: ${p.audioPercent ?? '—'}%`;
  el('segmentStats').textContent = `${p.ready} از ${p.total} جمله آماده`;
  el('speakerStats').textContent = `${status.speakers || 0} ${status.sourceMode === 'groq-live' ? 'برچسب گوینده در پنجره‌های ضبط' : 'گویندهٔ تشخیص‌داده‌شده'}`;
  el('remainingStats').textContent = `${p.remaining} جمله باقی‌مانده${p.failed ? ` · ${p.failed} خطا` : ''}`;
  updateControls();
}
function filtered() {
  const query = el('searchText').value.trim().toLowerCase(), speaker = el('speakerFilter').value;
  return (project?.segments || []).filter(s => (!query || `${s.sourceText || ''} ${s.text}`.toLowerCase().includes(query)) && (!speaker || `${s.speakerScope}:${s.speaker}` === speaker));
}
function node(tag, className, text) {
  const result = document.createElement(tag); if (className) result.className = className; if (text != null) result.textContent = text; return result;
}
function renderSegments() {
  const list = filtered(), maxPage = Math.max(0, Math.ceil(list.length / PAGE_SIZE) - 1);
  pageNumber = Math.min(pageNumber, maxPage);
  const container = el('segments'); container.replaceChildren();
  if (!list.length) { const empty = node('div','empty'); empty.append(node('h3',null,project ? 'جمله‌ای با این فیلتر پیدا نشد.' : 'گفت‌وگو اینجا شکل می‌گیرد.'),node('p',null,'فایل کامل یا پروژهٔ قبلی را باز کنید.')); container.append(empty); }
  for (const s of list.slice(pageNumber * PAGE_SIZE, (pageNumber + 1) * PAGE_SIZE)) {
    const row = node('article','segment'); row.dataset.id = s.id;
    const head = node('div','segment-head');
    head.append(node('span','segment-number',String(s.id + 1).padStart(2,'0')),node('span','speaker-name',s.speaker == null ? 'گوینده نامشخص' : `گوینده ${Number(s.speaker) + 1}${s.speakerScope === 'file' ? '' : ` · بخش ${s.speakerScope ?? '?'}`}`),node('span',`segment-state${s.failed ? ' failed' : ''}`,s.ready ? 'صدا آماده' : s.failed ? 'خطا در صدا' : 'نیاز به ساخت صدا'));
    const body = node('div','segment-body'), original = node('p','source-text',s.sourceText || 'متن منبع در این پروژه ذخیره نشده است.');
    const text = node('textarea','translation-text'); text.value = s.text; text.maxLength = 3000; text.dataset.field = 'text'; text.setAttribute('aria-label',`ترجمهٔ جملهٔ ${s.id + 1}`); body.append(original,text);
    const fields = node('div','segment-fields');
    for (const [key,title,value] of [['startMs','شروع · ثانیه',(s.startMs / 1000).toFixed(3)],['endMs','پایان · ثانیه',(s.endMs / 1000).toFixed(3)],['voiceId','Voice ID',s.voiceId || project.voiceId]]) {
      const label = node('label',null,title), input = node('input',key === 'voiceId' ? 'voice-input' : '');
      input.type = key === 'voiceId' ? 'text' : 'number'; input.value = value; input.dataset.field = key;
      if (input.type === 'number') { input.min = 0; input.step = .001; } label.append(input); fields.append(label);
    }
    const actions = node('div','segment-actions');
    for (const [action,title] of [['save','ذخیرهٔ ویرایش'],['regenerate','بازسازی این جمله'],['preview','شنیدن صدا']]) { const button = node('button',null,title); button.type = 'button'; button.dataset.action = action; actions.append(button); }
    row.append(head,body,fields,actions);
    if (s.error) row.append(node('span','row-error',s.error)); container.append(row);
    if (s.confidence != null && s.confidence < .8) row.append(node('span','row-error','تشخیص بعضی کلمات کم‌اطمینان است؛ متن اصلی را با صدا بررسی کنید.'));
  }
  el('pageInfo').textContent = `${pageNumber + 1} / ${maxPage + 1} · ${list.length} جمله`;
  el('previousPage').disabled = pageNumber === 0; el('nextPage').disabled = pageNumber === maxPage;
  updateControls();
}
function renderSpeakerFilter() {
  const selected = el('speakerFilter').value;
  el('speakerFilter').replaceChildren(new Option('همهٔ گوینده‌ها',''));
  const identities = new Map((project?.segments || []).filter(s => s.speaker != null).map(s => [`${s.speakerScope}:${s.speaker}`,s]));
  for (const [key,s] of identities) el('speakerFilter').append(new Option(`گوینده ${Number(s.speaker) + 1}${s.speakerScope === 'file' ? '' : ` · بخش ${s.speakerScope ?? '?'}`}`,key));
  el('speakerFilter').value = selected;
  const voiceSelected = el('voiceSpeaker').value;
  el('voiceSpeaker').replaceChildren(new Option('انتخاب گوینده…',''));
  for (const [key,s] of identities) el('voiceSpeaker').append(new Option(`گوینده ${Number(s.speaker)+1} · ${project.segments.filter(x=>`${x.speakerScope}:${x.speaker}`===key).length} جمله`,key));
  el('voiceSpeaker').value = voiceSelected;
}
async function projects() {
  const selected = el('projectSelect').value, jobs = await StudioDB.all('jobs');
  el('projectSelect').replaceChildren(new Option('انتخاب پروژه…',''));
  for (const job of jobs.sort((a,b) => b.createdAt - a.createdAt)) el('projectSelect').append(new Option(job.title || job.videoId,job.jobKey));
  el('projectSelect').value = selected || project?.jobKey || '';
}
async function refresh(force = false) {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await message('EASYTS_GET_STATUS'); applyStatus(response.status);
    const next = (await message('EASYTS_PROJECT_GET')).job;
    const signature = job => job ? `${job.jobKey}:${job.revision || 0}:${job.segments.filter(s => s.ready).length}:${job.segments.filter(s => s.failed).length}:${job.segments.length}:${job.segments.filter(s=>s.translated===false).length}` : '';
    if (force || signature(next) !== signature(project)) {
      if (document.querySelector('.segment.dirty')) { if (force) error('ابتدا ویرایش جمله را ذخیره کنید؛ تازه‌سازی متن‌های ذخیره‌نشده را پاک می‌کند.'); return; }
      project = next;
      exportRecord = project ? await StudioDB.get('exports',project.jobKey) : null;
      videoRecord = project ? await StudioDB.get('exports',`video:${project.jobKey}`) : null;
      renderSpeakerFilter(); renderSegments(); await projects();
      el('backgroundGain').value = Math.round((project?.background?.gain ?? .35)*100);
      el('backgroundDuck').value = Math.round((project?.background?.duck ?? .3)*100);
      const background = project?.background?.key ? await StudioDB.get('sources',project.background.key) : null;
      el('backgroundName').textContent = background?.name || 'بدون پس‌زمینه';
    } else if (project && !busy()) { exportRecord = await StudioDB.get('exports',project.jobKey); videoRecord = await StudioDB.get('exports',`video:${project.jobKey}`); updateControls(); }
  } catch (e) { error(e.message); } finally { refreshing = false; }
}
async function loadSettings() {
  settings = (await message('EASYTS_SETTINGS_GET')).settings;
  for (const [id,key] of [['deepgramKey','deepgramApiKey'],['groqKey','groqApiKey'],['defaultVoice','fishVoiceId'],['translationModel','groqTranslationModel'],['translationStyle','translationStyle'],['glossary','translationGlossary'],['projectNotes','projectNotes'],['pronunciation','pronunciationRules']]) el(id).value = settings[key] || '';
  el('fishKey').value = settings.fishApiKeys?.[0] || '';
}
async function saveSettings() {
  const patch = {deepgramApiKey:el('deepgramKey').value.trim(),groqApiKey:el('groqKey').value.trim(),fishVoiceId:el('defaultVoice').value.trim(),groqTranslationModel:el('translationModel').value,translationStyle:el('translationStyle').value,translationGlossary:el('glossary').value,projectNotes:el('projectNotes').value,pronunciationRules:el('pronunciation').value};
  const firstKey = el('fishKey').value.trim(); patch.fishApiKeys = firstKey ? [firstKey,...(settings.fishApiKeys || []).slice(1)] : [];
  settings = (await message('EASYTS_SETTINGS_SET',{settings:patch})).settings;
  el('settingsSaved').textContent = 'تنظیمات ذخیره شد.';
}
el('sourceFile').addEventListener('change',()=>{el('fileName').textContent=el('sourceFile').files[0]?.name || 'هنوز فایلی انتخاب نشده';updateControls();});
el('processFileBtn').addEventListener('click',()=>act(el('processFileBtn'),async()=>{
  if (document.querySelector('.segment.dirty')) throw new Error('ابتدا ویرایش جمله‌ها را ذخیره کنید.');
  const file = el('sourceFile').files[0]; if (!file || file.size > 200 * 1024 * 1024 || !file.size) throw new Error('یک فایل غیرخالی تا ۲۰۰ مگابایت انتخاب کنید.');
  localBusy = true; updateControls();
  try {
    await saveSettings();
    el('statusLabel').textContent = 'ذخیره و بررسی فایل…';
    const hash = await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    const key = [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
    await StudioDB.put('sources',{key,blob:file,name:file.name,createdAt:Date.now()});
    await message('EASYTS_FILE_START',{sourceKey:key});
    status.phase = 'starting'; project = null; exportRecord = null; pageNumber = 0;
    renderSegments(); await refresh(true);
  } finally { localBusy = false; }
}));
el('saveSettingsBtn').addEventListener('click',()=>act(el('saveSettingsBtn'),saveSettings));
el('voiceSpeaker').addEventListener('change',()=>{
  const s=project?.segments.find(s=>`${s.speakerScope}:${s.speaker}`===el('voiceSpeaker').value);
  el('speakerVoice').value=s?.voiceId || project?.voiceId || '';updateControls();
});
async function mutateStudio(type, values) {
  if (!project || document.querySelector('.segment.dirty')) throw new Error('پروژه را باز کنید و ویرایش جمله‌ها را ذخیره کنید.');
  localBusy=true;updateControls();
  try { await message(type,{jobKey:project.jobKey,revision:project.revision||0,...values}); await refresh(true); }
  finally { localBusy=false;updateControls(); }
}
el('assignVoiceBtn').addEventListener('click',()=>act(el('assignVoiceBtn'),()=>mutateStudio('EASYTS_PROJECT_VOICE',{speakerKey:el('voiceSpeaker').value,voiceId:el('speakerVoice').value})));
el('backgroundFile').addEventListener('change',()=>{el('backgroundName').textContent=el('backgroundFile').files[0]?.name || 'فایل جدیدی انتخاب نشده';});
el('saveMixBtn').addEventListener('click',()=>act(el('saveMixBtn'),async()=>{
  localBusy=true;updateControls();
  try {
  let key=project?.background?.key;
  const file=el('backgroundFile').files[0];
  if(file){
    if(!file.size || file.size>200*1024*1024)throw new Error('ترک باید غیرخالی و حداکثر ۲۰۰ مگابایت باشد.');
    const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    key=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
    await StudioDB.put('sources',{key,blob:file,name:file.name,createdAt:Date.now()});
  }
  if(!key)throw new Error('ابتدا ترک مستقل پس‌زمینه را انتخاب کنید.');
  await mutateStudio('EASYTS_PROJECT_MIX',{backgroundKey:key,gain:Number(el('backgroundGain').value)/100,duck:Number(el('backgroundDuck').value)/100});
  el('backgroundFile').value='';
  } finally {localBusy=false;updateControls();}
}));
el('clearMixBtn').addEventListener('click',()=>act(el('clearMixBtn'),async()=>{
  await mutateStudio('EASYTS_PROJECT_MIX',{backgroundKey:null,gain:.35,duck:.3});el('backgroundFile').value='';
}));
el('refreshBtn').addEventListener('click',()=>refresh(true));
el('restoreBtn').addEventListener('click',()=>act(el('restoreBtn'),async()=>{if(document.querySelector('.segment.dirty'))throw new Error('ابتدا ویرایش جمله را ذخیره کنید.');await message('EASYTS_PROJECT_RESTORE',{jobKey:el('projectSelect').value});pageNumber=0;await refresh(true);}));
el('projectSelect').addEventListener('change',updateControls);
el('stopStudioBtn').addEventListener('click',()=>act(el('stopStudioBtn'),async()=>{await message('EASYTS_STOP');await refresh();}));
el('regenerateMissingBtn').addEventListener('click',()=>act(el('regenerateMissingBtn'),async()=>{if(document.querySelector('.segment.dirty'))throw new Error('ابتدا ویرایش جمله‌ها را ذخیره کنید.');await message('EASYTS_PROJECT_REGENERATE',{jobKey:project.jobKey});status.phase='generating';updateControls();}));
el('renderAudioBtn').addEventListener('click',()=>act(el('renderAudioBtn'),async()=>{if(document.querySelector('.segment.dirty'))throw new Error('ابتدا ویرایش جمله‌ها را ذخیره کنید.');await message('EASYTS_RENDER_AUDIO',{jobKey:project.jobKey});status.phase='exporting';updateControls();}));
el('downloadAudioBtn').addEventListener('click',()=>{if(exportRecord)download(exportRecord.blob,`Easy-ts-${project.title.replace(/[^\p{L}\p{N}._-]/gu,'_')}.wav`);});
el('renderVideoBtn').addEventListener('click',()=>act(el('renderVideoBtn'),async()=>{if(document.querySelector('.segment.dirty'))throw new Error('ابتدا ویرایش جمله‌ها را ذخیره کنید.');await message('EASYTS_RENDER_VIDEO',{jobKey:project.jobKey});status.phase='exporting';updateControls();}));
el('downloadVideoBtn').addEventListener('click',()=>{if(videoRecord)download(videoRecord.blob,`Easy-ts-${project.title.replace(/[^\p{L}\p{N}._-]/gu,'_')}.webm`);});
el('exportSrtStudio').addEventListener('click',()=>{if(project)download(new Blob(['\uFEFF',EasyTsCore.srt(EasyTsCore.sequentialTimeline(project.segments))],{type:'text/plain;charset=utf-8'}),'Easy-ts-fa.srt');});
for(const id of ['searchText','speakerFilter'])el(id).addEventListener('input',()=>{if(document.querySelector('.segment.dirty')){error('ابتدا ویرایش جمله را ذخیره کنید.');return;}pageNumber=0;renderSegments();});
el('previousPage').addEventListener('click',()=>{if(document.querySelector('.segment.dirty'))return error('ابتدا ویرایش جمله را ذخیره کنید.');pageNumber--;renderSegments();});
el('nextPage').addEventListener('click',()=>{if(document.querySelector('.segment.dirty'))return error('ابتدا ویرایش جمله را ذخیره کنید.');pageNumber++;renderSegments();});
el('segments').addEventListener('input',event=>{event.target.closest('.segment')?.classList.add('dirty');updateControls();});
el('segments').addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');if(!button||busy())return;
  const row=button.closest('.segment'),segmentId=Number(row.dataset.id);
  act(button,async()=>{
    if(button.dataset.action==='save'){
      const value=field=>row.querySelector(`[data-field="${field}"]`).value;
      localBusy=true;updateControls();
      try{const result=await message('EASYTS_PROJECT_EDIT',{jobKey:project.jobKey,revision:project.revision||0,segmentId,text:value('text'),voiceId:value('voiceId'),startMs:Math.round(Number(value('startMs'))*1000),endMs:Math.round(Number(value('endMs'))*1000)});project.revision=result.revision;row.classList.remove('dirty');await refresh(true);}finally{localBusy=false;}
    }else if(button.dataset.action==='regenerate'){
      if(row.classList.contains('dirty'))throw new Error('ابتدا ویرایش این جمله را ذخیره کنید.');
      await message('EASYTS_PROJECT_REGENERATE',{jobKey:project.jobKey,segmentId});status.phase='generating';updateControls();
    }else{
      if(row.classList.contains('dirty'))throw new Error('پیش‌نمایش متعلق به متن ذخیره‌شده است؛ ابتدا ویرایش را ذخیره و صدا را بازسازی کنید.');
      const record=await StudioDB.get('audio',`${project.jobKey}:${segmentId}`);if(!record?.blob)throw new Error('صدای جمله در کش موجود نیست.');
      const audio=el('studioPreview');audio.pause();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(record.blob);audio.src=previewUrl;audio.hidden=false;await audio.play();
    }
  });
});
chrome.runtime.onMessage.addListener(message=>{if(message.type==='EASYTS_OFFSCREEN_STATUS_BROADCAST')applyStatus(message.status);});
window.addEventListener('beforeunload',event=>{if(document.querySelector('.segment.dirty')){event.preventDefault();event.returnValue='';}});
window.addEventListener('unload',()=>{clearInterval(poll);if(previewUrl)URL.revokeObjectURL(previewUrl);});
(async()=>{try{
  await loadSettings();await projects();
  const requested = new URL(location.href).searchParams.get('job');
  if (requested && [...el('projectSelect').options].some(option=>option.value===requested)) {
    el('projectSelect').value=requested;
    await message('EASYTS_PROJECT_RESTORE',{jobKey:requested});
  }
  await refresh(true);poll=setInterval(refresh,2000);
}catch(e){error(e.message);}updateControls();})();
