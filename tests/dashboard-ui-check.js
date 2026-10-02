async(page)=>{
  await page.route('http://127.0.0.1:8780/**',route=>route.continue());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    localStorage.removeItem('easyts-theme');
    const settings={fishApiKeys:[],fishVoiceId:'',speakerVoices:[],speakerMode:false,ttsProvider:'elevenlabs',sttProvider:'deepgram',translationProvider:'gemini',autoSpeakerVoices:true};
    window.sentMessages=[];
    window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async m=>{window.sentMessages.push(m);if(m.type==='EASYTS_SETTINGS_GET')return{ok:true,settings};if(m.type==='EASYTS_SETTINGS_SET'){Object.assign(settings,m.settings);return{ok:true,settings};}if(m.type==='EASYTS_CACHE_STATS')return{ok:true,bytes:5242880,jobs:2,audioFiles:12};if(m.type==='EASYTS_PAGE_STATE')return{ok:true,page:{bridge:true,hasVideo:true}};if(m.type==='EASYTS_GET_STATUS')return{ok:true,status:{phase:'generating',videoId:'demo',title:'گفت‌وگوی علمی',sourceMode:'youtube-captions',totalSegments:10,translatedSegments:10,readySegments:4,failedSegments:0,etaSeconds:64}};return{ok:true};}},tabs:{query:async()=>[{id:41,url:'https://www.youtube.com/watch?v=demo',title:'چطور صدا به زبان دیگری تبدیل می‌شود؟ - YouTube',lastAccessed:2},{id:42,url:'https://www.youtube.com/shorts/another',title:'پروژهٔ دوم - YouTube',lastAccessed:1}]}};
  });
  await page.goto('http://127.0.0.1:8780/dashboard.html');
  await page.setViewportSize({width:1440,height:1100});
  await page.locator('#dashProvider').filter({hasText:'ElevenLabs'}).waitFor();
  await page.waitForFunction(()=>document.getElementById('progressPercent').textContent==='70%');
  const check=(condition,label)=>{if(!condition)throw new Error(label);};
  check(await page.locator('.workspace-sidebar nav a[aria-current]').textContent()==='داشبورد','active navigation');
  await page.locator('.youtube-section>summary').click();await page.locator('#dashboardVideoTab').selectOption('42');
  await page.waitForFunction(()=>sentMessages.some(m=>m.type==='EASYTS_PAGE_STATE'&&m.tabId===42));
  check(await page.locator('#videoTitle').textContent()==='پروژهٔ دوم','video selection');
  await page.waitForFunction(()=>document.getElementById('startBtn').disabled);
  check(await page.locator('#startBtn').isDisabled(),'reconnecting cannot enable a duplicate start during processing');
  await page.evaluate(async()=>{await StudioDB.put('jobs',{jobKey:'ui-demo',title:'مصاحبهٔ علمی.mp4',sourceMode:'file',createdAt:Date.now(),segments:[{ready:true},{ready:false}]});});
  await page.waitForFunction(()=>document.getElementById('recentProjects').textContent.includes('مصاحبهٔ علمی'),{},{timeout:12000});
  await page.locator('.recent-project[href="studio.html?job=ui-demo"]').waitFor();
  check((await page.locator('.recent-project[href="studio.html?job=ui-demo"]').getAttribute('href')).includes('job=ui-demo'),'project opens selected job');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'desktop overflow');
  await page.screenshot({path:'output/playwright/dashboard-desktop.png',fullPage:true});
  await page.locator('#workspaceTheme').click();
  check(await page.evaluate(()=>document.documentElement.dataset.theme==='light'),'light mode');
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('stopBtn')).backgroundColor==='rgb(255, 255, 255)');
  await page.screenshot({path:'output/playwright/dashboard-light.png',fullPage:true});
  await page.locator('#workspaceTheme').click();
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('stopBtn')).backgroundColor==='rgb(32, 36, 41)');
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
  await page.screenshot({path:'output/playwright/dashboard-mobile.png',fullPage:true});
  check(errors.length===0,errors.join('\n'));
  console.log('Dashboard checks passed: real overview data, active navigation, YouTube tab selection, project links, dark/light themes, mobile layout and no page errors.');
}
