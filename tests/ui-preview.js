async (page) => {
  await page.addInitScript(() => {
    const settings = {fishApiKeys:[],fishVoiceId:'',speakerVoices:[],speakerMode:false};
    window.chrome = {
      runtime: {
        onMessage: {addListener() {}},
        sendMessage: async message => {
          if (message.type === 'EASYTS_SETTINGS_GET') return {ok:true, settings};
          if (message.type === 'EASYTS_SETTINGS_SET') { Object.assign(settings,message.settings); return {ok:true,settings}; }
          if (message.type === 'EASYTS_PAGE_STATE') return {ok:true,page:{bridge:true,hasVideo:true}};
          if (message.type === 'EASYTS_CACHE_STATS') return {ok:true,bytes:0,jobs:0,audioFiles:0};
          if (message.type === 'EASYTS_GET_STATUS') return {ok:true,status:{phase:'idle',label:'آماده برای ترجمه و دوبله',totalSegments:0,translatedSegments:0,readySegments:0,failedSegments:0}};
          return {ok:true};
        }
      },
      tabs: {query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=demo',title:'گفت‌وگوی علمی — ترجمه و دوبلهٔ فارسی'}]}
    };
  });
  await page.reload();
  await page.setViewportSize({width:460,height:600});
  console.log(await page.locator('body').innerText());
  console.log('horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
}
