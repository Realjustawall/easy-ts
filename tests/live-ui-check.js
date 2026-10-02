async(page)=>{
  await page.goto('http://127.0.0.1:8780/live.html');
  await page.evaluate(async()=>{
    settings={...EasyTsProviders.defaults,geminiApiKey:'mock-key',liveProvider:'gemini',liveInput:'microphone'};
    document.getElementById('startLive').disabled=false;
    window.captureMode='deny';window.captureTracks=[];window.sockets=[];
    const makeStream=()=>{const context=new AudioContext(),destination=context.createMediaStreamDestination(),oscillator=context.createOscillator();oscillator.connect(destination);oscillator.start();context.resume();window.captureContext=context;const stream=destination.stream;captureTracks.push(...stream.getTracks());return stream;};
    navigator.mediaDevices.getUserMedia=async()=>{
      if(captureMode==='deny')throw new DOMException('Permission denied','NotAllowedError');
      if(captureMode==='pending')return new Promise(resolve=>{window.resolveCapture=()=>resolve(makeStream());});return makeStream();
    };
    chrome.runtime.getURL=path=>new URL('/'+path,location.origin).href;
    window.WebSocket=class{
      static OPEN=1;
      constructor(){this.readyState=0;this.bufferedAmount=0;this.sent=[];sockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},10);}
      send(data){const message=JSON.parse(data);this.sent.push(message);if(message.setup)setTimeout(()=>this.onmessage?.({data:JSON.stringify({setupComplete:{}})}),10);}
      close(){this.readyState=3;this.onclose?.();}
    };
  });
  const check=(c,label)=>{if(!c)throw new Error(label);};
  await page.locator('#startLive').click();await page.getByText('جلسه شروع نشد.',{exact:true}).waitFor();check(await page.locator('#startLive').isEnabled(),'permission error allows retry');
  await page.evaluate(()=>captureMode='ready');await page.locator('#startLive').click();await page.getByText('متصل · دریافت صدا',{exact:true}).waitFor();
  await page.waitForFunction(()=>sockets[0].sent.some(x=>x.realtimeInput?.audio?.data));
  check(await page.evaluate(()=>sockets[0].sent[0].setup.model==='models/gemini-3.8-live'),'setup sent');
  await page.locator('#stopLive').click();await page.getByText('جلسه پایان یافت.',{exact:true}).waitFor();
  check(await page.evaluate(()=>captureTracks.every(t=>t.readyState==='ended')&&sockets[0].readyState===3&&active===null),'stop releases tracks and socket');
  await page.evaluate(async()=>{await captureContext.close();captureMode='pending';});await page.locator('#startLive').click();await page.waitForFunction(()=>typeof resolveCapture==='function');await page.locator('#stopLive').click();
  await page.evaluate(()=>resolveCapture());await page.waitForFunction(()=>captureTracks.every(t=>t.readyState==='ended'));
  check(await page.evaluate(()=>sockets.length===1&&active===null),'cancelled permission cannot open late session');
  await page.evaluate(async()=>{await captureContext.close();document.getElementById('connection').textContent='آماده';document.getElementById('liveModel').textContent='Gemini Live · gemini-3.8-live';});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'output/playwright/live-desktop.png'});
  await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
  console.log('Live lifecycle passed: denied permission, PCM capture, session setup, stop cleanup and cancellation before capture resolves.');
}
