const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const config=require('../provider-config.js'),schema=require('../settings-schema.js'),live=require('../live-protocol.js'),core=require('../engine-core.js');
test('single configured TTS key resolves without altering saved settings or crossing voice maps',()=>{
 const s={...config.defaults,fishApiKeys:[],elevenApiKey:'mock',elevenVoiceId:'chosen',autoSpeakerVoices:true,elevenSpeakerVoices:['speaker']};
 assert.equal(config.tts(s),'elevenlabs');assert.equal(config.voice(s),'chosen');assert.equal(config.speakerVoice(s,0),'speaker');assert.equal(config.resolve(s).ttsProvider,'elevenlabs');assert.equal(s.ttsProvider,'fish');
 assert.equal(config.tts({...s,ttsAutoSelect:false}),'fish');assert.equal(config.tts({...s,openaiApiKey:'second'}),'fish');assert.equal(config.tts({...s,ttsProvider:'local'}),'local');
 assert.equal(config.tts({...config.defaults,geminiApiKey:'only'}),'gemini');
});
test('local settings validate loopback URLs and reject malformed endpoints',()=>{
 assert.equal(schema.validate({localTtsUrl:'http://localhost:8880/v1',ttsProvider:'local'}).ttsProvider,'local');
 for(const url of ['file:///tmp','http://remote.test/v1','http://user:pass@localhost/v1','http://localhost/v1?secret=1'])assert.throws(()=>schema.validate({localSttUrl:url}));
});
test('local TTS and STT use independent endpoints, optional auth and timed speaker turns',async()=>{
 const audio=engine(()=>new Uint8Array(200));await audio.run(`synthesizeProvider({text:'Hello'},{ttsProvider:'local',localTtsUrl:'http://localhost:8880/v1',localTtsModel:'kokoro',localVoice:'voice',localApiKey:'private'})`);
 assert.equal(audio.calls[0].url,'http://localhost:8880/v1/audio/speech');assert.equal(JSON.parse(audio.calls[0].init.body).model,'kokoro');assert.equal(audio.calls[0].init.headers.Authorization,'Bearer private');
 const stt=engine({segments:[{start:0,end:1,text:'Hello',speaker:'A'},{start:.5,end:2,text:'Yes',speaker:'B'}]});const turns=await stt.run(`transcribeProvider(new Blob(['data']),{sttProvider:'local',localSttUrl:'http://127.0.0.1:8000/v1',localSttModel:'whisper'})`);
 assert.equal(stt.calls[0].url,'http://127.0.0.1:8000/v1/audio/transcriptions');assert.equal(stt.calls[0].init.body.get('response_format'),'verbose_json');assert.deepEqual(Array.from(turns,x=>x.speaker),[0,1]);assert.equal(Object.hasOwn(stt.calls[0].init.headers,'Authorization'),false);
 const invalid=engine({text:'No timings'});await assert.rejects(invalid.run(`transcribeProvider(new Blob(['data']),{sttProvider:'local'})`));
});
test('Gemini blocked responses and empty candidates are explicit errors',async()=>{
 const e=engine({promptFeedback:{blockReason:'SAFETY'}});await assert.rejects(e.run(`geminiGenerate({geminiApiKey:'mock'},'models/gemini-3.8-flash',{})`),/SAFETY/);assert.ok(!e.calls[0].url.includes('models%2F'));
});
test('large Gemini STT uploads real bytes, references the file and cleans it up on success or failure',async()=>{
 for(const broken of [false,true]){
  const calls=[];const ctx=vm.createContext({URL,Blob,FormData,AbortSignal,atob,btoa,EasyTsProviders:config,EasyTsCore:core,sleep:async()=>{},fetchGroqWithRetry:async(url,init)=>{
   calls.push({url,init});
   if(url.endsWith('/upload/v1beta/files'))return new Response('',{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/session'}});
   if(url.endsWith('/session'))return Response.json({file:{name:'files/test',uri:'https://generativelanguage.googleapis.com/v1beta/files/test',state:'PROCESSING'}});
   if(init.method==='DELETE')return new Response('',{status:200});
   if(url.endsWith('/files/test'))return Response.json({name:'files/test',uri:'https://generativelanguage.googleapis.com/v1beta/files/test',state:'ACTIVE',mimeType:'audio/wav'});
   if(broken)throw new Error('network failed');return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({segments:[{start:0,end:1,speaker:'A',text:'Hello'}]})}]}}]});
  }});vm.runInContext(fs.readFileSync('provider-engine.js','utf8'),ctx);
  const work=vm.runInContext(`transcribeProvider(new Blob([new Uint8Array(15*1024*1024)],{type:'audio/wav'}),{sttProvider:'gemini',geminiApiKey:'mock'})`,ctx);
  if(broken)await assert.rejects(work,/network failed/);else assert.equal((await work).length,1);
  assert.equal(calls[1].init.body.size,15*1024*1024);assert.equal(calls.at(-1).init.method,'DELETE');
  const request=calls.find(c=>c.url.endsWith(':generateContent'));assert.equal(JSON.parse(request.init.body).contents[0].parts[0].fileData.mimeType,'audio/wav');
 }
});
function engine(result){const calls=[];const ctx=vm.createContext({URL,Blob,FormData,AbortController,AbortSignal,atob,btoa,EasyTsProviders:config,EasyTsCore:core,console,fetchGroqWithRetry:async(url,init)=>{init.signal?.throwIfAborted();calls.push({url,init});return new Response(typeof result==='function'?result(url,init):JSON.stringify(result),{headers:{'Content-Type':typeof result==='function'?'audio/wav':'application/json'}});}});vm.runInContext(fs.readFileSync('provider-engine.js','utf8'),ctx);return {ctx,calls,run:code=>vm.runInContext(code,ctx)};}
test('provider requirements are independent; speaker voice maps never bleed between providers',()=>{
  const s={...config.defaults,ttsProvider:'gemini',geminiApiKey:'mock',autoSpeakerVoices:true,speakerVoices:['fish-id'],geminiSpeakerVoices:['Puck']};
  assert.equal(config.check(s,'tts'),'gemini');assert.equal(config.speakerVoice(s,0),'Puck');assert.throws(()=>config.check(s,'translation'),/groq/);
  assert.equal(config.stt(s,'file'),'deepgram');assert.equal(config.stt(s,'capture'),'groq');
  assert.equal(Object.keys(config.fingerprint(s)).some(k=>/ApiKey$/.test(k)),false);
});
test('settings reject invalid providers, numeric bounds and malformed voice maps',()=>{
  assert.throws(()=>schema.validate({ttsProvider:'imaginary'}));assert.throws(()=>schema.validate({liveMaxMinutes:0}));assert.throws(()=>schema.validate({elevenSpeakerVoices:'bad'}));assert.throws(()=>schema.validate({fishConcurrency:1.5}));assert.throws(()=>schema.validate({chunkTargetSec:12,chunkMaxSec:8}));assert.deepEqual(schema.validate({elevenApiKey:'  key ',unknown:'discard'}),{elevenApiKey:'key'});
});
test('ElevenLabs TTS uses chosen voice, pronunciation, model and voice controls',async()=>{
  const e=engine(()=>new Uint8Array(200));
  await e.run(`synthesizeProvider({text:'OpenAI سلام',speaker:0},{ttsProvider:'elevenlabs',elevenApiKey:'mock',elevenVoiceId:'default',autoSpeakerVoices:true,elevenSpeakerVoices:['chosen'],pronunciationRules:'OpenAI = اوپن ای آی',elevenTtsModel:'eleven_v3',elevenStability:.5},undefined)`);
  assert.match(e.calls[0].url,/chosen\?output_format/);const body=JSON.parse(e.calls[0].init.body);assert.equal(body.model_id,'eleven_v3');assert.equal(body.voice_settings.stability,.5);assert.match(body.text,/اوپن/);assert.equal(e.calls[0].init.headers['xi-api-key'],'mock');
});
test('ElevenLabs STT preserves word turns and speaker identity across the recording',async()=>{
  const e=engine({words:[{type:'word',text:'Hello',start:0,end:.5,speaker_id:'speaker_0'},{type:'word',text:'world',start:.5,end:1,speaker_id:'speaker_0'},{type:'word',text:'Yes',start:.8,end:1.2,speaker_id:'speaker_1'},{type:'word',text:'Again',start:2,end:3,speaker_id:'speaker_0'},{type:'spacing',text:' ',start:3,end:3}]});
  const turns=await e.run(`transcribeProvider(new Blob(['audio'],{type:'audio/wav'}),{sttProvider:'elevenlabs',elevenApiKey:'mock',sourceLanguage:'en'},undefined)`);
  const groups=core.normalizeUtterances(turns,{startVideoSec:0,playbackRate:1,scope:'file'},12,220);
  assert.equal(groups.length,3);assert.equal(groups[0].text,'Hello world');assert.deepEqual(groups.map(s=>s.speaker),[0,1,0]);assert.equal(groups[1].startMs,800);
  assert.equal(e.calls[0].init.body.get('diarize'),'true');assert.equal(e.calls[0].init.body.get('file').name,'audio.wav');
});
test('Gemini translation sends schema and rejects duplicate or missing IDs',async()=>{
  const e=engine({candidates:[{content:{parts:[{text:JSON.stringify({items:[{id:0,text:'سلام'},{id:0,text:'تکرار'}]})}]}}]});
  await assert.rejects(e.run(`translateProvider([{id:0,text:'Hi'},{id:1,text:'Yes'}],{translationProvider:'gemini',geminiApiKey:'mock',geminiTranslationModel:'gemini-3.8-flash'})`),/تکراری/);
  const body=JSON.parse(e.calls[0].init.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.responseJsonSchema.type,'object');
});
test('OpenAI translation uses independent model and strict schema',async()=>{
  const e=engine({choices:[{message:{content:JSON.stringify({items:[{id:3,text:'بله'}]})}}]});
  const r=await e.run(`translateProvider([{id:3,text:'Yes'}],{translationProvider:'openai',openaiApiKey:'mock',openaiTranslationModel:'gpt-4.1-mini'})`);
  assert.equal(r[0].id,3);const body=JSON.parse(e.calls[0].init.body);assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.model,'gpt-4.1-mini');
});
test('Gemini 3.8 TTS uses generateContent verbatim text, style metadata and voice',async()=>{
 const bytes=Buffer.from('RIFF'+'.'.repeat(200));const e=engine({candidates:[{content:{parts:[{inlineData:{data:bytes.toString('base64'),mimeType:'audio/wav'}}]}}]});
 const blob=await e.run(`synthesizeProvider({text:'Hello'},{ttsProvider:'gemini',geminiApiKey:'mock',geminiVoice:'Kore',geminiTtsModel:'gemini-3.8-flash-tts',ttsInstructions:'calm'})`);
 assert.equal(blob.size,bytes.length);assert.match(e.calls[0].url,/:generateContent$/);const body=JSON.parse(e.calls[0].init.body);assert.equal(body.generationConfig.speechConfig.voiceConfig.voice,'Kore');assert.equal(body.contents[0].parts[0].text,'Hello');assert.equal(body.contents[0].parts[0].speech_metadata.style,'calm');
});
test('Gemini 2.5 TTS wraps PCM with exact rate and length',async()=>{
  const e=engine({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/L16;rate=24000',data:Buffer.alloc(240).toString('base64')}}]}}]});
  const blob=await e.run(`synthesizeProvider({text:'سلام'},{ttsProvider:'gemini',geminiApiKey:'mock',geminiVoice:'Kore',geminiTtsModel:'gemini-2.5-flash-preview-tts'})`);
  const b=Buffer.from(await blob.arrayBuffer());assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(24),24000);assert.equal(b.length,284);
});
test('OpenAI STT requests diarized output and auto chunking; unknown speaker is not invented',async()=>{
  const e=engine({segments:[{start:0,end:1,speaker:'A',text:'Hello'},{start:.5,end:2,speaker:'B',text:'Yes'},{start:2,end:3,speaker:'A',text:'Again'}]});
  const r=await e.run(`transcribeProvider(new Blob(['audio'],{type:'audio/wav'}),{sttProvider:'openai',openaiApiKey:'mock',openaiSttModel:'gpt-4o-transcribe-diarize'})`);
  assert.deepEqual(Array.from(r,x=>x.speaker),[0,1,0]);assert.equal(e.calls[0].init.body.get('response_format'),'diarized_json');assert.equal(e.calls[0].init.body.get('chunking_strategy'),'auto');
  const unknown=e.run(`utterancesFromSegments([{start:0,end:1,text:'No speaker label'}])`);assert.equal(unknown[0].speaker,null);
});
test('STT limits and unsupported timing models reject before a paid request',async()=>{
  const e=engine({});await assert.rejects(e.run(`transcribeProvider(new Blob([new Uint8Array(26*1024*1024)]),{sttProvider:'openai',openaiApiKey:'mock'})`),/۲۵/);
  await assert.rejects(e.run(`transcribeProvider(new Blob(['audio']),{sttProvider:'openai',openaiApiKey:'mock',openaiSttModel:'gpt-4o-mini-transcribe'})`),/زمان/);assert.equal(e.calls.length,0);
});
test('Gemini STT returns valid numeric timings and discards invalid segments',async()=>{
  const e=engine({candidates:[{content:{parts:[{text:JSON.stringify({segments:[{start:0,end:1,speaker:'host',text:'Hi'},{start:1,end:2,speaker:'guest',text:'Yes'},{start:-1,end:2,speaker:'host',text:'invalid'}]})}]}}]});
  const r=await e.run(`transcribeProvider(new Blob(['audio'],{type:'audio/wav'}),{sttProvider:'gemini',geminiApiKey:'mock',geminiSttModel:'gemini-3.8-flash'})`);assert.equal(r.length,2);assert.equal(r[1].speaker,1);assert.ok(JSON.parse(e.calls[0].init.body).contents[0].parts[0].inlineData.data);
});
test('OpenAI TTS honors instructions only for instruction-aware models',async()=>{
  const e=engine(()=>new Uint8Array(200));await e.run(`synthesizeProvider({text:'سلام'},{ttsProvider:'openai',openaiApiKey:'mock',openaiVoice:'coral',openaiTtsModel:'tts-1',ttsInstructions:'Do not send this'})`);assert.equal(Object.hasOwn(JSON.parse(e.calls[0].init.body),'instructions'),false);
});
test('Realtime, GPT-Live and Gemini use distinct documented session schemas',()=>{
  const s={...config.defaults};const g=live.geminiSetup(s).setup;assert.equal(g.generationConfig.responseModalities[0],'AUDIO');assert.equal(g.realtimeInputConfig.activityHandling,'NO_INTERRUPTION');
  const r=live.realtimeSession(s);assert.equal(r.type,'realtime');assert.equal(r.audio.input.turn_detection.interrupt_response,false);assert.equal(r.audio.output.voice,'marin');
  const l=live.liveSession(s,'v=0');assert.equal(l.transport.type,'webrtc');assert.equal(l.session.model,'gpt-live-1');assert.equal(l.session.delegation.type,'responses');assert.equal(l.transport.sdp,'v=0');
  assert.equal(live.pcmFloat(Uint8Array.from([0,128,255,127]))[0],-1);
});
