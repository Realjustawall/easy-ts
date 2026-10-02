const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('background.js','utf8');
test('YouTube validation accepts Shorts and watch URLs while rejecting unrelated pages',()=>{
 const c=vm.createContext({URL});vm.runInContext(source.slice(source.indexOf('function isYoutubeWatch'),source.indexOf('let offscreenCreation')),c);
 for(const url of ['https://www.youtube.com/shorts/abc','https://youtube.com/watch?v=abc'])assert.equal(vm.runInContext(`isYoutubeWatch(${JSON.stringify(url)})`,c),true);
 for(const url of ['https://youtube.com/shorts/','https://youtube.com/','https://fake-youtube.com/shorts/abc'])assert.equal(vm.runInContext(`isYoutubeWatch(${JSON.stringify(url)})`,c),false);
});
function harness(send){
  let exists=false,creates=0;
  const ctx=vm.createContext({OFFSCREEN_URL:'offscreen.html',setTimeout:fn=>setImmediate(fn),chrome:{runtime:{getURL:s=>s,getContexts:async()=>exists?[{}]:[],sendMessage:send||(async()=>({ok:true}))},offscreen:{createDocument:async()=>{creates++;await new Promise(resolve=>setImmediate(resolve));exists=true;}}}});
  vm.runInContext(source.slice(source.indexOf('let offscreenCreation'),source.indexOf('async function getYoutubeTab')),ctx);
  return {run:code=>vm.runInContext(code,ctx),creates:()=>creates};
}
test('concurrent status and sync requests create only one offscreen document',async()=>{
  const h=harness();await h.run(`Promise.all(Array.from({length:12},()=>sendToOffscreen({type:'OFFSCREEN_GET_STATUS'})))`);assert.equal(h.creates(),1);
});
test('new offscreen receiver startup retries only undelivered requests',async()=>{
  let calls=0;const h=harness(async()=>{calls++;if(calls<3)throw new Error('Could not establish connection. Receiving end does not exist.');return {ok:true};});
  await h.run(`sendToOffscreen({type:'OFFSCREEN_GET_STATUS'})`);assert.equal(calls,3);
  let delivered=0;const failing=harness(async()=>{delivered++;throw new Error('The message port closed before a response was received.');});
  await assert.rejects(failing.run(`sendToOffscreen({type:'OFFSCREEN_START_FALLBACK'})`));assert.equal(delivered,1);
});
test('forwarded popup status cannot recurse through the background listener',()=>{
  const guard=source.match(/chrome\.runtime\.onMessage\.addListener\(\(message, sender, sendResponse\) => \{([\s\S]*?)\(async/)[1];
  const route=new Function('message',guard+'return true;');
  assert.equal(route({type:'EASYTS_CONTENT_STATUS',target:'popup'}),false);
  assert.equal(route({target:'offscreen'}),false);
  assert.equal(route({type:'EASYTS_CONTENT_STATUS',target:'background'}),true);
});

