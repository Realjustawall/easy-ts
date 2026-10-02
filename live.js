const $=id=>document.getElementById(id);let settings,active=null,serial=0;
async function send(type,values={}){const r=await chrome.runtime.sendMessage({type,...values});if(!r?.ok)throw new Error(r?.error||'پاسخ دریافت نشد.');return r;}
function error(text){$('settingsError').textContent=text||'';$('settingsError').hidden=!text;}
function assertSession(s){if(active!==s)throw new DOMException('Session stopped','AbortError');}
function append(label,text){if(!settings.liveTranscripts||!text)return;const p=document.createElement('p');p.textContent=`${label}: ${text}`;$('transcript').append(p);while($('transcript').childElementCount>180)$('transcript').firstChild.remove();$('transcript').scrollTop=$('transcript').scrollHeight;}
function clearPlayback(s){for(const node of s.playing||[])try{node.stop();}catch{}s.playing?.clear();s.nextTime=0;}
async function stop(reason='جلسه پایان یافت.'){
  const s=active;active=null;serial++;if(s){clearInterval(s.timer);clearTimeout(s.deadline);s.controller.abort();s.stream?.getTracks().forEach(t=>t.stop());s.input?.disconnect();s.worklet?.disconnect();clearPlayback(s);
    if(s.settings.liveProvider==='openai-live'&&s.channel?.readyState==='open'){
      // Keep the data channel briefly for the server's final usage notification.
      s.channel.send(JSON.stringify({type:'session.close'}));s.closeTimeout=setTimeout(()=>{s.channel?.close();s.peer?.close();if(!active&&!s.finalized)$('sessionTime').textContent='جلسه قطع شد؛ مصرف نهایی از سرویس تأیید نشد.';},15000);
    }else{s.channel?.close();s.peer?.close();}
    if(s.socket?.readyState===WebSocket.OPEN){s.socket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));}s.socket?.close();await s.context?.close().catch(()=>{});
  }
  $('liveAudio').pause();$('liveAudio').srcObject=null;$('startLive').disabled=!settings;$('stopLive').disabled=true;$('inputMode').disabled=false;$('connection').textContent=reason;
}
function playPcm(s,data,rate=24000){assertSession(s);const raw=atob(data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),samples=EasyTsLive.pcmFloat(bytes);const buffer=s.context.createBuffer(1,samples.length,rate);buffer.copyToChannel(samples,0);const node=s.context.createBufferSource();node.buffer=buffer;node.connect(s.output);const start=Math.max(s.context.currentTime+.02,s.nextTime||0);if(start-s.context.currentTime>20)throw new Error('صف صدا بیش از حد طولانی شد؛ جلسه را دوباره شروع کنید.');node.start(start);s.nextTime=start+buffer.duration;s.playing.add(node);node.onended=()=>s.playing.delete(node);}
async function connectGemini(s){
  s.context=new AudioContext({sampleRate:16000});await s.context.resume();assertSession(s);
  s.output=s.context.createGain();s.output.gain.value=Number($('outputVolume').value);s.output.connect(s.context.destination);s.playing=new Set();
  await s.context.audioWorklet.addModule(chrome.runtime.getURL('live-worklet.js'));assertSession(s);
  const socket=new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(s.settings.geminiApiKey)}`);s.socket=socket;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Gemini Live در ۳۰ ثانیه آماده نشد؛ مدل، کلید و شبکه را بررسی کنید.')),30000);
    const failed=e=>{clearTimeout(timer);reject(e);};
    socket.onopen=()=>{if(active!==s){socket.close();return;}socket.send(JSON.stringify(EasyTsLive.geminiSetup(s.settings)));};
    socket.onerror=()=>failed(new Error('اتصال Gemini Live برقرار نشد؛ کلید، مدل و دسترسی شبکه را بررسی کنید.'));
    socket.onclose=event=>{clearTimeout(timer);if(active===s){const message=`Gemini Live اتصال را بست (${event.code}): ${String(event.reason||'مدل، مجوز حساب و شبکه را بررسی کنید.').slice(0,240)}`;failed(new Error(message));error(message);void stop('ارتباط قطع شد.');}};
    let queue=Promise.resolve();
    socket.onmessage=event=>{queue=queue.then(async()=>{
      if(active!==s)return;const text=typeof event.data==='string'?event.data:await event.data.text();assertSession(s);const message=JSON.parse(text);
      if(message.error)throw new Error(message.error.message||'خطای Gemini Live');
      if(message.setupComplete){clearTimeout(timer);resolve();return;}
      if(message.goAway){append('وضعیت','سرویس در حال پایان‌دادن به جلسه است.');return;}
      const content=message.serverContent;if(!content)return;
      if(content.interrupted)clearPlayback(s);
      append('ورودی',content.inputTranscription?.text);append('ترجمه',content.outputTranscription?.text);
      for(const part of content.modelTurn?.parts||[]){if(part.inlineData?.data)playPcm(s,part.inlineData.data,Number(part.inlineData.mimeType?.match(/rate=(\d+)/)?.[1]||24000));else if(part.text)append('ترجمه',part.text);}
    }).catch(e=>{failed(e);if(active===s){error(e.message);void stop('جلسه متوقف شد.');}});};
    s.controller.signal.addEventListener('abort',()=>failed(s.controller.signal.reason),{once:true});
  });
  assertSession(s);s.input=s.context.createMediaStreamSource(s.stream);s.worklet=new AudioWorkletNode(s.context,'easy-ts-capture');const silent=s.context.createGain();silent.gain.value=0;
  s.worklet.port.onmessage=event=>{if(active!==s||socket.readyState!==WebSocket.OPEN)return;if(socket.bufferedAmount>1024*1024){error('شبکه از جریان صدا عقب افتاده است.');void stop('جلسه متوقف شد.');return;}const bytes=new Uint8Array(event.data);let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);socket.send(JSON.stringify({realtimeInput:{audio:{mimeType:'audio/pcm;rate=16000',data:btoa(raw)}}}));};
  s.input.connect(s.worklet);s.worklet.connect(silent);silent.connect(s.context.destination);
}
async function connectOpenai(s){
  const peer=new RTCPeerConnection();s.peer=peer;
  peer.ontrack=event=>{if(active!==s)return;$('liveAudio').srcObject=event.streams[0]||new MediaStream([event.track]);$('liveAudio').hidden=false;$('liveAudio').volume=Number($('outputVolume').value);$('liveAudio').play().catch(()=>append('وضعیت','برای شنیدن ترجمه، پخش صدا را بزنید.'));};
  for(const track of s.stream.getAudioTracks())peer.addTrack(track,s.stream);
  peer.onconnectionstatechange=()=>{if(active===s&&['failed','disconnected'].includes(peer.connectionState)){error('ارتباط صوتی قطع شد.');void stop('ارتباط قطع شد.');}};
  const channel=peer.createDataChannel('oai-events');s.channel=channel;
  const ready=new Promise((resolve,reject)=>{
    channel.onmessage=event=>{try{const message=JSON.parse(event.data);
      if(message.type==='session.closed'){s.finalized=true;clearTimeout(s.closeTimeout);s.channel?.close();s.peer?.close();if(active===s)void stop('جلسه توسط سرویس بسته شد.');else if(!active)$('sessionTime').textContent=`جلسه بسته شد${message.usage?.seconds!=null?` · مصرف صوت: ${message.usage.seconds} ثانیه`:''}`;return;}
      if(active!==s)return;
      if(message.type==='session.created'||message.type==='session.started')resolve();
      if(message.type==='error'){const e=new Error(message.error?.message||'خطای API زنده');reject(e);error(e.message);void stop('جلسه متوقف شد.');}
      if(message.type==='conversation.item.input_audio_transcription.completed')append('ورودی',message.transcript);
      if(message.type==='response.output_audio_transcript.delta')append('ترجمه',message.delta);
      if(message.type.includes('transcript')&&s.settings.liveProvider==='openai-live')append(message.type.includes('input')?'ورودی':'ترجمه',message.transcript||message.text||message.delta);
    }catch(e){reject(e);error(e.message);void stop('پاسخ سرویس نامعتبر بود.');}};
    channel.onclose=()=>{if(active===s){reject(new Error('کانال جلسه بسته شد.'));void stop('ارتباط قطع شد.');}};
    s.controller.signal.addEventListener('abort',()=>reject(s.controller.signal.reason),{once:true});
  });ready.catch(()=>{});
  await peer.setLocalDescription(await peer.createOffer());assertSession(s);
  if(peer.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{peer.removeEventListener('icegatheringstatechange',changed);reject(new Error('جمع‌آوری اطلاعات اتصال طول کشید.'));},10000);function changed(){if(peer.iceGatheringState==='complete'){clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',changed);resolve();}}peer.addEventListener('icegatheringstatechange',changed);changed();});assertSession(s);
  const r=await send('EASYTS_LIVE_CONNECT',{provider:s.settings.liveProvider,sdp:peer.localDescription.sdp});assertSession(s);
  await peer.setRemoteDescription({type:'answer',sdp:r.sdp});await ready;assertSession(s);
}
async function start(){
  if(active)return;error('');const s={id:++serial,controller:new AbortController(),settings:{...settings},started:Date.now()};active=s;$('startLive').disabled=true;$('stopLive').disabled=false;$('inputMode').disabled=true;$('connection').textContent='در حال اتصال…';
  s.deadline=setTimeout(()=>{if(active===s){error('اتصال در ۳۰ ثانیه کامل نشد.');void stop('اتصال ناموفق');}},30000);
  try{
    const key=s.settings.liveProvider==='gemini'?s.settings.geminiApiKey:s.settings.openaiApiKey;if(!key?.trim())throw new Error('کلید سرویس زنده را در تنظیمات وارد و ذخیره کنید.');
    s.stream=$('inputMode').value==='tab'?await navigator.mediaDevices.getDisplayMedia({video:true,audio:true}):await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    if(active!==s){s.stream.getTracks().forEach(t=>t.stop());assertSession(s);}
    if(!s.stream.getAudioTracks().length)throw new Error('ورودی صدا موجود نیست؛ اشتراک صدای تب را روشن کنید.');
    for(const track of s.stream.getTracks())track.addEventListener('ended',()=>{if(active===s)void stop('اشتراک صدا پایان یافت.');},{once:true});
    if(s.settings.liveProvider==='gemini')await connectGemini(s);else await connectOpenai(s);
    assertSession(s);clearTimeout(s.deadline);$('connection').textContent='متصل · دریافت صدا';s.started=Date.now();
    s.timer=setInterval(()=>{if(active!==s)return;const seconds=Math.floor((Date.now()-s.started)/1000);$('sessionTime').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · قطع خودکار پس از ${s.settings.liveMaxMinutes} دقیقه`;if(seconds>=Number(s.settings.liveMaxMinutes)*60)void stop('سقف مدت جلسه رسید.');},1000);
  }catch(e){if(active===s){error(e.message);await stop('جلسه شروع نشد.');}}
}
$('startLive').onclick=start;$('stopLive').onclick=()=>stop();$('clearTranscript').onclick=()=>$('transcript').replaceChildren();$('outputVolume').oninput=()=>{const v=Number($('outputVolume').value);$('liveAudio').volume=v;if(active?.output)active.output.gain.setTargetAtTime(v,active.context.currentTime,.03);};
window.addEventListener('pagehide',()=>{void stop();});
send('EASYTS_SETTINGS_GET').then(r=>{settings={...EasyTsProviders.defaults,...r.settings};$('inputMode').value=settings.liveInput;$('liveModel').textContent=settings.liveProvider==='gemini'?`Gemini Live · ${settings.geminiLiveModel}`:settings.liveProvider==='openai-live'?`GPT-Live · ${settings.openaiLiveModel}`:`OpenAI Realtime · ${settings.openaiRealtimeModel}`;$('startLive').disabled=false;}).catch(e=>error(e.message));
