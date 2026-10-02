async(page)=>{
  await page.route('http://127.0.0.1:8780/**',r=>r.continue());
  await page.addInitScript(()=>{
    let values;window.settingsWrites=[];
    window.chrome={runtime:{sendMessage:async message=>{
      values||={...EasyTsProviders.defaults,fishApiKeys:[],fishVoiceId:'',fishModel:'s2.1-pro-free',fishConcurrency:5,fishRetries:3,fishLatency:'balanced',ttsBitrate:64,chunkTargetSec:8,chunkMaxSec:12,chunkMaxChars:220,maxTimeStretch:1.65,groqApiKey:'',deepgramApiKey:'',whisperModel:'whisper-large-v3-turbo',groqTranslationModel:'openai/gpt-oss-20b',fallbackCaptureSec:15,showPersianSubtitles:true,autoApplyWhenReady:false,translationStyle:'natural',speakerMode:false,speakerVoices:[],translationGlossary:'',projectNotes:'',pronunciationRules:''};
      if(message.type==='EASYTS_SETTINGS_GET')return {ok:true,settings:values};
      if(message.type==='EASYTS_SETTINGS_SET'){Object.assign(values,message.settings);window.settingsWrites.push(message.settings);return {ok:true,settings:values};}
      if(message.type==='EASYTS_PROVIDER_TEST')return {ok:true,text:'ترجمهٔ آزمایشی'};
      return {ok:false,error:'unexpected'};
    }}};
  });
  await page.goto('http://127.0.0.1:8780/settings.html');await page.setViewportSize({width:1440,height:1000});
  await page.getByText('تنظیمات دریافت شد',{exact:true}).waitFor();
  const check=(c,label)=>{if(!c)throw new Error(label);};
  await page.locator('#ttsProvider').selectOption('elevenlabs');await page.locator('#elevenApiKey').fill('mock-secret');await page.locator('#elevenVoiceId').fill('chosen-voice');await page.locator('#translationProvider').selectOption('gemini');await page.locator('#geminiApiKey').fill('mock-gemini');
  await page.locator('#autoSpeakerVoices').check();
  await page.locator('#elevenSpeakerVoices').fill('voice-one\nvoice-two');
  await page.locator('#liveProvider').selectOption('openai-live');await page.locator('#saveSettings').click();await page.getByText('همهٔ تغییرات ذخیره شدند').waitFor();
  check(await page.evaluate(()=>settingsWrites.at(-1).autoSpeakerVoices === true && settingsWrites.at(-1).elevenSpeakerVoices.length === 2),'optional multi-speaker voices saved');
  check(await page.evaluate(()=>settingsWrites.at(-1).ttsProvider==='elevenlabs'&&settingsWrites.at(-1).liveProvider==='openai-live'),'provider selection persisted');
  await page.locator('#testTranslation').click();await page.getByText('ترجمهٔ آزمایشی',{exact:true}).waitFor();
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportSettings').click();const download=await downloadPromise;await download.saveAs('output/playwright/settings-export.json');
  const exported=await page.evaluate(()=>{const v=collect();delete v.fishApiKeys;for(const k of Object.keys(v))if(/ApiKey$/.test(k))delete v[k];return v;});check(!Object.keys(exported).some(k=>/ApiKey/.test(k)),'keys excluded from export');
  await page.locator('#importSettings').setInputFiles({name:'settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,settings:{ttsProvider:'openai',openaiVoice:'marin',elevenApiKey:'malicious-overwrite'}}))});
  await page.waitForFunction(()=>document.getElementById('ttsProvider').value==='openai');
  check(await page.locator('#ttsProvider').inputValue()==='openai','import provider');check(await page.locator('#elevenApiKey').inputValue()==='mock-secret','import preserves key');
  await page.locator('#saveSettings').click();await page.getByText('همهٔ تغییرات ذخیره شدند').waitFor();
  await page.locator('#liveMaxMinutes').fill('0');await page.locator('#saveSettings').click();check(await page.locator('#liveMaxMinutes').evaluate(n=>!n.validity.valid),'bounds enforced');await page.locator('#liveMaxMinutes').fill('15');await page.locator('#saveSettings').click();await page.waitForFunction(()=>dirty===false);
  await page.locator('#ttsProvider').selectOption('local');await page.locator('#sttProvider').selectOption('local');await page.locator('#localTtsUrl').fill('http://localhost:8880/v1');await page.locator('#localSttUrl').fill('http://127.0.0.1:8000/v1');await page.locator('#localTtsModel').fill('kokoro');await page.locator('#localSttModel').fill('whisper');await page.locator('#localVoice').fill('voice');
  await page.locator('#saveSettings').click();await page.waitForFunction(()=>dirty===false);check(await page.evaluate(()=>settingsWrites.at(-1).ttsProvider==='local'&&settingsWrites.at(-1).localTtsModel==='kokoro'),'local routing saved');
  check((await page.locator('#ttsResolved').textContent()).includes('مدل محلی'),'effective provider visible');
  await page.locator('#ttsProvider').selectOption('fish');await page.locator('#openaiApiKey').fill('');await page.locator('#geminiApiKey').fill('');await page.locator('#fishApiKeys').fill('');await page.locator('#ttsAutoSelect').check();check((await page.locator('#ttsResolved').textContent()).includes('ElevenLabs'),'single-key routing visible');await page.locator('#saveSettings').click();await page.waitForFunction(()=>dirty===false);
  await page.locator('#settingsSearch').fill('eleven');
  check(await page.locator('#eleven').isVisible(),'settings search finds provider');
  check(await page.locator('#gemini').isHidden(),'settings search hides unrelated sections');
  await page.locator('#settingsSearch').fill('');
  check(await page.locator('#gemini').isVisible(),'clearing search restores fields');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'output/playwright/settings-desktop.png'});
  await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');await page.screenshot({path:'output/playwright/settings-mobile.png'});
  check(await page.evaluate(()=>getComputedStyle(document.body).fontFamily.includes('Vazir')),'Vazir font');console.log('Settings controls passed: provider routing, save/import/export, key preservation, numeric validation, translation test and mobile layout.');
}
