async (page) => {
  await page.addInitScript(() => {
    window.fixtureJob = {jobKey:'studio-preview',videoId:'file:demo',sourceKey:'demo',sourceMode:'file',voiceId:'voice-default',title:'گفت‌وگوی علمی · دو گوینده.mp4',revision:0,createdAt:Date.now(),segments:Array.from({length:65},(_,i)=>({id:i,startMs:i*1500,endMs:i*1500+1200,speaker:i%2,speakerScope:'file',sourceText:i%2?'Yes, and what happens next?':'Let us look at the experiment.',text:i%2?'بله، بعد چه اتفاقی می‌افتد؟':'بیایید آزمایش را بررسی کنیم.',translated:true,ready:true,voiceId:i%2?'voice-bob':'voice-alice'}))};
    const settings={fishApiKeys:[],fishVoiceId:'voice-default',speakerVoices:[],groqTranslationModel:'openai/gpt-oss-120b',translationStyle:'natural'};
    window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async message=>{
      const job=window.fixtureJob;
      if(message.type==='EASYTS_SETTINGS_GET')return{ok:true,settings};
      if(message.type==='EASYTS_SETTINGS_SET'){Object.assign(settings,message.settings);return{ok:true,settings};}
      if(message.type==='EASYTS_GET_STATUS')return{ok:true,status:{title:job.title,jobKey:job.jobKey,phase:'ready',sourceMode:'file',label:'پروژه آمادهٔ بازبینی است.',totalSegments:65,translatedSegments:65,readySegments:job.segments.filter(s=>s.ready).length,failedSegments:0,speakers:2}};
      if(message.type==='EASYTS_PROJECT_GET')return{ok:true,job:JSON.parse(JSON.stringify(job))};
      if(message.type==='EASYTS_PROJECT_MIX'){if(message.revision!==job.revision)return{ok:false,error:'stale'};job.background=message.backgroundKey?{key:message.backgroundKey,gain:message.gain,duck:message.duck}:null;job.revision++;return{ok:true};}
      if(message.type==='EASYTS_PROJECT_VOICE'){if(message.revision!==job.revision)return{ok:false,error:'stale'};for(const s of job.segments)if(`${s.speakerScope}:${s.speaker}`===message.speakerKey){s.voiceId=message.voiceId;s.ready=false;}job.revision++;return{ok:true};}
      if(message.type==='EASYTS_PROJECT_EDIT'){if(message.revision!==job.revision)return{ok:false,error:'stale'};const segment=job.segments.find(s=>s.id===message.segmentId);Object.assign(segment,{text:message.text,startMs:message.startMs,endMs:message.endMs,voiceId:message.voiceId,ready:false});job.revision++;return{ok:true,revision:job.revision};}
      return{ok:true};
    }}};
  });
  await page.goto('http://127.0.0.1:8780/studio.html');await page.setViewportSize({width:1440,height:1000});
  await page.locator('.segment').first().waitFor();
  await page.evaluate(async()=>{clearInterval(poll);await StudioDB.put('jobs',window.fixtureJob);await projects();});
  const check=(condition,label)=>{if(!condition)throw new Error(label);};
  check(await page.locator('.segment').count()===30,'paginated rows');
  check(await page.locator('#studioPercent').textContent()==='100%','finite-file progress');
  check(await page.locator('#renderAudioBtn').isEnabled(),'audio render enabled');
  await page.locator('#nextPage').click();check(await page.locator('#pageInfo').textContent()==='2 / 3 · 65 جمله','pagination');
  await page.locator('#previousPage').click();
  await page.locator('#speakerFilter').selectOption('file:1');check(await page.locator('.segment').count()===30,'speaker filtering');
  await page.locator('#speakerFilter').selectOption('');
  const row=page.locator('.segment').first();await row.locator('textarea').fill('متن اصلاح‌شدهٔ فارسی');
  await page.locator('#refreshBtn').click();check(await row.locator('textarea').inputValue()==='متن اصلاح‌شدهٔ فارسی','unsaved edits preserved');
  await row.getByRole('button',{name:'ذخیرهٔ ویرایش',exact:true}).click();
  await page.locator('.segment.dirty').waitFor({state:'detached'});
  check(await page.locator('.segment').first().locator('textarea').inputValue()==='متن اصلاح‌شدهٔ فارسی','saved text persisted');
  check(await page.locator('#renderAudioBtn').isDisabled(),'stale audio prevents export');
  check(await page.locator('#regenerateMissingBtn').isEnabled(),'selective regeneration enabled');
  await page.locator('.speaker-tools summary').click();
  await page.locator('#voiceSpeaker').selectOption('file:1');
  await page.locator('#speakerVoice').fill('voice-new-bob');
  await page.locator('#assignVoiceBtn').click();
  await page.waitForFunction(()=>project?.revision===2);
  check(await page.evaluate(()=>project.segments.filter(s=>s.speaker===1).every(s=>s.voiceId==='voice-new-bob'&&!s.ready)),'bulk voice applied');
  await page.locator('.mix-panel summary').click();
  await page.locator('#backgroundFile').setInputFiles({name:'music.wav',mimeType:'audio/wav',buffer:Buffer.from('fixture')});
  await page.locator('#backgroundGain').fill('45');
  await page.locator('#backgroundDuck').fill('20');
  await page.locator('#saveMixBtn').click();
  await page.waitForFunction(()=>project?.revision===3);
  check(await page.evaluate(()=>project.background.gain===.45&&project.background.duck===.2),'mix settings saved');
  await page.locator('#clearMixBtn').click();
  await page.waitForFunction(()=>project?.revision===4);
  check(await page.evaluate(()=>project.background===null),'background removed');
  await page.screenshot({path:'output/playwright/studio-editor.png'});
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
  await page.screenshot({path:'output/playwright/studio-mobile.png'});
  console.log('Studio UI checks passed: full-file progress, pagination, speaker filtering, unsaved edits, revision save, stale-audio guard, regeneration and mobile layout.');
}
