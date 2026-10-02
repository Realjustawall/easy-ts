const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const original=fs.readFileSync('content.js','utf8');
const source=original.replace(/\}\)\(\);\s*$/,`window.testContent={getVideo,getVideoId,onNavigate,sendRuntime,sendSync,attachSync,rpc,disposeContent,state:()=>({disposed,applied,syncTimer}),setApplied:()=>{applied=true;sourceMode='youtube-captions';}};})();`);
function events(){const listeners=new Map();return {listeners,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};}
function harness(){
  const timers=new Map(),window=events(),video={...events(),currentTime:1,duration:60,paused:false,playbackRate:1,volume:1,muted:false,dataset:{}};
  let sequence=0,calls=0,behavior=()=>Promise.resolve({ok:true});const runtimeListeners=new Set();
  const chrome={runtime:{id:'extension-test',sendMessage:message=>{calls++;return behavior(message);},onMessage:{addListener:fn=>runtimeListeners.add(fn),removeListener:fn=>runtimeListeners.delete(fn)}}};
  const ctx=vm.createContext({window,chrome,URL,location:{href:'https://www.youtube.com/watch?v=video'},document:{querySelector:()=>video},setInterval:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),setTimeout,clearTimeout,console});
  const load=()=>vm.runInContext(source,ctx);load();return {window,video,chrome,ctx,timers,runtimeListeners,load,calls:()=>calls,setBehavior:fn=>{behavior=fn;},api:()=>window.testContent};
}
test('Shorts navigation uses the active video and stops previous dubbing on scroll',async()=>{
 const h=harness(),api=h.api();h.ctx.location.href='https://www.youtube.com/shorts/first';assert.equal(api.getVideoId(),'first');api.onNavigate();await Promise.resolve();
 let selector;h.ctx.document.querySelector=s=>{selector=s;return h.video;};assert.equal(api.getVideo(),h.video);assert.match(selector,/is-active/);
 api.attachSync(h.video);api.setApplied();h.video.dataset.easyTsWasMuted='false';h.video.muted=true;
 const sent=[];h.setBehavior(m=>{sent.push(m);return Promise.resolve({ok:true});});h.ctx.location.href='https://www.youtube.com/shorts/second';api.onNavigate();await Promise.resolve();
 assert.equal(api.getVideoId(),'second');assert.equal(h.video.muted,false);assert.equal(api.state().applied,false);assert.equal(h.timers.size,0);assert.ok(sent.some(m=>m.type==='EASYTS_STOP'));
});
test('synchronous invalidated-context error in sync restores sound and removes timers/listeners',async()=>{
  const h=harness(),api=h.api();api.attachSync(h.video);api.setApplied();h.video.dataset.easyTsWasMuted='false';h.video.muted=true;
  h.setBehavior(()=>{throw new Error('Extension context invalidated.');});
  assert.doesNotThrow(()=>api.sendSync());await Promise.resolve();
  assert.equal(api.state().disposed,true);assert.equal(h.video.muted,false);assert.equal(h.timers.size,0);assert.equal(h.runtimeListeners.size,0);
  assert.equal(h.window.listeners.get('yt-navigate-finish').size,0);
  assert.equal([...h.video.listeners.values()].some(set=>set.size),false);
  const calls=h.calls();api.sendSync();assert.equal(h.calls(),calls);
});
test('promise context errors and missing runtime ID also dispose safely',async()=>{
  for(const missingId of [false,true]){
    const h=harness();h.api().attachSync(h.video);
    if(missingId)delete h.chrome.runtime.id;
    else h.setBehavior(()=>Promise.reject(new Error('Extension context invalidated.')));
    await assert.rejects(h.api().sendRuntime({type:'EASYTS_SETTINGS_GET'}),/دوباره بارگذاری/);
    assert.equal(h.api().state().disposed,true);assert.equal(h.timers.size,0);
  }
});
test('transient transport failures preserve the active page and can recover',async()=>{
  const h=harness();h.api().attachSync(h.video);h.setBehavior(()=>Promise.reject(new Error('Could not establish connection.')));
  await assert.rejects(h.api().sendRuntime({type:'EASYTS_SYNC'}));assert.equal(h.api().state().disposed,false);assert.equal(h.timers.size,1);
  h.setBehavior(()=>Promise.resolve({ok:true}));assert.equal((await h.api().sendRuntime({type:'EASYTS_SYNC'})).ok,true);
});
test('re-injection disposes the previous content instance and does not duplicate listeners',()=>{
  const h=harness(),old=h.api();old.attachSync(h.video);h.window.__easyTsContentVersion='older';h.load();
  assert.equal(old.state().disposed,true);assert.equal(h.timers.size,0);assert.equal(h.runtimeListeners.size,1);
  assert.equal(h.window.listeners.get('message').size,1);assert.equal(h.window.listeners.get('yt-navigate-finish').size,1);
  h.load();assert.equal(h.runtimeListeners.size,1);
});
test('pending bridge RPC is cancelled when the extension context is invalidated',async()=>{
  const h=harness();h.window.postMessage=()=>{};
  const pending=h.api().rpc('GET_CAPTION_META',{},10000),rejected=assert.rejects(pending,/دوباره بارگذاری/);
  h.setBehavior(()=>{throw new Error('Extension context invalidated.');});
  await assert.rejects(h.api().sendRuntime({type:'EASYTS_SYNC'}));await rejected;
});
