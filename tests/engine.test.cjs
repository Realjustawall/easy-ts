const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../engine-core.js');

test('file pipeline combines ElevenLabs STT, Gemini translation and OpenAI voices without legacy keys',async()=>{
  const e=engine(),requests=[],records=new Map();
  const settings={...e.EasyTsProviders.defaults,sttProvider:'elevenlabs',translationProvider:'gemini',ttsProvider:'openai',elevenApiKey:'mock',geminiApiKey:'mock',openaiApiKey:'mock',openaiVoice:'coral',openaiSpeakerVoices:['coral','cedar'],autoSpeakerVoices:true,speakerVoices:['wrong-fish-id'],fishConcurrency:2};
  e.getSettings=async()=>settings;e.StudioDB.get=async()=>({blob:new Blob(['source'],{type:'audio/wav'}),name:'input.wav'});
  e.idbGet=async(store,key)=>records.get(`${store}:${key}`);e.idbPut=async(store,value)=>records.set(`${store}:${value.key||value.jobKey}`,value);
  e.fetchGroqWithRetry=async(url,init)=>{requests.push({url,init});return {ok:true,json:async()=>url.includes('elevenlabs')?{words:[{type:'word',text:'Hello',speaker_id:'speaker_0',start:0,end:1},{type:'word',text:'Yes',speaker_id:'speaker_1',start:.5,end:1.5}]}:{candidates:[{content:{parts:[{text:JSON.stringify({items:[{id:0,text:'سلام'},{id:1,text:'بله'}]})}]}}]},blob:async()=>new Blob(['x'.repeat(200)],{type:'audio/wav'})};};
  await e.run(`prepareFileJob('source')`);
  assert.equal(e.run('currentJob.ttsProvider'),'openai');assert.equal(e.run('currentJob.voiceId'),'coral');assert.equal(e.run('currentStatus.phase'),'ready');
  assert.deepEqual(requests.filter(r=>r.url.includes('/audio/speech')).map(r=>JSON.parse(r.init.body).voice),['coral','cedar']);
  assert.equal(requests.some(r=>/fish|deepgram|groq/.test(r.url)),false);
  settings.ttsProvider='elevenlabs';await assert.rejects(e.run(`regenerateStudio({jobKey:currentJob.jobKey})`),/متفاوت/);
});

test('background ducking merges overlapping speech and smoothly recovers in silence', () => {
  const audio=require('../audio-render.js'), rate=1000;
  const out=new Float32Array(3000), input=new Float32Array(3000).fill(1);
  audio.background(out,input,rate,[{startMs:500,endMs:1400},{startMs:1000,endMs:2000}],.5,.2);
  assert.ok(Math.abs(out[300]-.5)<.001);
  assert.ok(Math.abs(out[1300]-.1)<.001);
  assert.ok(Math.abs(out[1800]-.1)<.001);
  assert.ok(out[2400]>.4 && out[2400]<.5);
  assert.throws(()=>audio.background(out,input,rate,[],NaN,.3));
});

test('background changes invalidate exports but retain every synthesized sentence', async () => {
  const ctx=engine(), removed=[];
  ctx.StudioDB.get=async()=>({blob:new Blob(['background'])});
  ctx.StudioDB.remove=async(store,key)=>removed.push([store,key]);
  ctx.run(`currentJob={jobKey:'mix',revision:2,segments:[{id:0,ready:true,translated:true}]};currentStatus.phase='ready';persistJob=async()=>{};`);
  await ctx.run(`configureStudioMix({jobKey:'mix',revision:2,backgroundKey:'stem',gain:.35,duck:.3})`);
  assert.equal(ctx.run('currentJob.revision'),3);
  assert.equal(ctx.run('currentJob.segments[0].ready'),true);
  assert.deepEqual(removed,[['exports','mix'],['exports','video:mix']]);
  await assert.rejects(ctx.run(`configureStudioMix({jobKey:'mix',revision:2,gain:.35,duck:.3})`));
});

test('bulk speaker voice change invalidates only matching sentences; repeat is a no-op', async () => {
  const ctx=engine(), removed=[];
  ctx.idbDelete=async(store,key)=>removed.push(key);ctx.StudioDB.remove=async()=>{};
  ctx.run(`currentJob={jobKey:'voices',voiceId:'default',revision:0,segments:[{id:0,speaker:0,speakerScope:'file',voiceId:'alice',ready:true},{id:1,speaker:1,speakerScope:'file',voiceId:'bob',ready:true},{id:2,speaker:0,speakerScope:'file',voiceId:'alice',ready:true}]};currentStatus.phase='ready';persistJob=async()=>{};`);
  const result=await ctx.run(`assignStudioVoice({jobKey:'voices',revision:0,speakerKey:'file:0',voiceId:'new-alice'})`);
  assert.equal(result.changed,2);assert.deepEqual(removed,['voices:0','voices:2']);
  assert.equal(ctx.run('currentJob.segments[1].ready'),true);
  const again=await ctx.run(`assignStudioVoice({jobKey:'voices',revision:1,speakerKey:'file:0',voiceId:'new-alice'})`);
  assert.equal(again.changed,0);assert.equal(again.revision,1);
});

function engine() {
  const broadcasts = [];
  class Audio {
    constructor() { this.paused = true; this.duration = 2; this.currentTime = 0; this.readyState = 1; }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
    removeAttribute() {}
    addEventListener() {}
    removeEventListener() {}
  }
  const ctx = vm.createContext({ Audio, EasyTsCore: core, AbortController, AbortSignal, DOMException, Blob, TextEncoder, URL, crypto: require('node:crypto').webcrypto, performance, console, setTimeout, clearTimeout,
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: async message => { broadcasts.push(message); return { ok: true, settings: {} }; } } }
  });
  ctx.FormData=FormData;ctx.atob=atob;ctx.btoa=btoa;
  ctx.EasyTsProviders=require('../provider-config.js');
  vm.runInContext(fs.readFileSync(require.resolve('../offscreen.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(require.resolve('../provider-engine.js'), 'utf8'), ctx);
  ctx.EasyTsAudio = require('../audio-render.js');
  ctx.StudioDB = { get: async () => null, remove: async () => {}, put: async () => {} };
  vm.runInContext(fs.readFileSync(require.resolve('../studio-engine.js'), 'utf8'), ctx);
  ctx.broadcasts = broadcasts;
  ctx.run = code => vm.runInContext(code, ctx);
  return ctx;
}

test('translation progress is independent of generated audio, failures remain incomplete', () => {
  const p = core.progress({ totalSegments: 10, translatedSegments: 4, readySegments: 0 });
  assert.equal(p.translationPercent, 40); assert.equal(p.overallPercent, 20); assert.equal(p.remaining, 10);
  const failed = core.progress({ totalSegments: 10, translatedSegments: 10, readySegments: 8, failedSegments: 2 });
  assert.equal(failed.overallPercent, 90); assert.equal(failed.remaining, 2);
});
test('live and unknown durations never pretend to have a total completion percentage', () => {
  assert.equal(core.progress({ totalSegments: 5, translatedSegments: 5, readySegments: 5, sourceMode: 'groq-live' }).overallPercent, null);
  assert.equal(core.progress({}).overallPercent, null);
});
test('overlapping speakers survive word grouping with scoped identities', () => {
  const groups = core.normalizeUtterances([
    { speaker: 0, words: [{ start: 0, end: 2, word: 'Hello', speaker: 0 }] },
    { speaker: 1, words: [{ start: 1, end: 3, word: 'Yes', speaker: 1 }] },
  ], { startVideoSec: 10, playbackRate: 2, scope: 7 });
  assert.equal(groups[0].endMs, 14000); assert.equal(groups[1].startMs, 12000);
  assert.equal(groups[1].speakerScope, 7);
  assert.equal(core.activeSegments(groups.map((s, id) => ({ ...s, id, ready: true })), 13000).length, 2);
});
test('turn boundaries and invalid timestamps never merge different speakers', () => {
  const groups = core.normalizeUtterances([{ words: [
    { start: 0, end: 1, word: 'one', speaker: 0 }, { start: 1, end: 2, word: 'two', speaker: 1 },
    { start: 'bad', end: 3, word: 'invalid', speaker: 1 }
  ] }], { startVideoSec: 0, playbackRate: 1, scope: 1 });
  assert.equal(groups.length, 2); assert.equal(groups[0].text, 'one');
});
test('SRT preserves overlap and has millisecond timestamps', () => {
  const srt = core.srt([{ startMs: 1250, endMs: 2050, text: 'سلام', speaker: 0, speakerScope: 3 }]);
  assert.match(srt, /00:00:01,250 --> 00:00:02,050/); assert.match(srt, /گوینده 1/);
});
test('overlapping turns play sequentially; pause, seek and wrong video stop audio', async () => {
  const e = engine();
  e.run(`idbGet = async () => ({ blob: new Blob(['audio']) }); currentJob = { jobKey: 'job', videoId: 'video', segments: [{ id: 0, startMs: 0, endMs: 4000, ready: true }, { id: 1, startMs: 1000, endMs: 4000, ready: true }] }; applied = true;`);
  await e.run(`syncDub({ videoId: 'video', currentTime: 1.2, paused: false, volume: 0.5, playbackRate: 1 })`);
  assert.equal(e.run(`[...audioLanes.values()].filter(l => !l.audio.paused).length`), 1);
  assert.ok(e.run(`[...audioLanes.values()][0].audio.volume === 0.5`));
  await e.run(`syncDub({ videoId: 'video', currentTime: 4.2, paused: false, volume: 0.5, playbackRate: 1 })`);
  assert.equal(e.run(`[...audioLanes].filter(([id,l]) => !l.audio.paused).map(([id])=>id).join(',')`), '1');
  await e.run(`syncDub({ videoId: 'video', currentTime: 1.2, paused: true })`);
  assert.equal(e.run(`[...audioLanes.values()].every(l => l.audio.paused)`), true);
  await e.run(`syncDub({ videoId: 'other', currentTime: 1.2, paused: false })`);
  assert.equal(e.run(`[...audioLanes.values()].every(l => l.audio.paused)`), true);
  await e.run(`syncDub({ videoId: 'video', currentTime: 10, paused: false })`);
  assert.equal(e.run('audioLanes.size'), 0);
});

test('rolling captions remove reused words while preserving new words and legitimate repetitions', () => {
  const cues = core.normalizeCaptions([
    {startMs:0,endMs:3000,text:'We are testing this'},
    {startMs:1000,endMs:4000,text:'testing this feature now'},
    {startMs:2000,endMs:5000,text:'feature now'},
    {startMs:6000,endMs:7000,text:'feature now'}
  ]);
  assert.deepEqual(cues.map(s=>s.text), ['We are testing this','feature now','feature now']);
  assert.equal(cues[0].endMs,1000);
  assert.equal(cues[1].endMs,5000);
});

test('serialized timelines retain every speaker and reserve enough room for long generated speech', () => {
  const segments=[{id:0,startMs:0,endMs:1000,audioDuration:4,ready:true},{id:1,startMs:500,endMs:1500,audioDuration:1,ready:true}];
  const timeline=core.sequentialTimeline(segments,2);
  assert.deepEqual(timeline.map(s=>[s.id,s.startMs,s.endMs]),[[0,0,2000],[1,2000,3000]]);
  assert.equal(core.activeSegments(timeline,1999)[0].id,0);
  assert.equal(core.activeSegments(timeline,2000)[0].id,1);
  assert.equal(segments[1].startMs,500);
});

test('automatic speaker voice assignment is optional and unknown speakers retain the default', () => {
  const config=require('../provider-config.js');
  const settings={ttsProvider:'fish',speakerVoices:['first','second']};
  assert.equal(config.speakerVoice(settings,1),'');
  settings.autoSpeakerVoices=true;
  assert.equal(config.speakerVoice(settings,1),'second');
  assert.equal(config.speakerVoice(settings,null),'');
  assert.equal(config.speakerVoice(settings,20),'');
});
test('stop invalidates an in-flight audio load and cannot restart playback', async () => {
  const e = engine();
  e.run(`let releaseRead; idbGet = () => new Promise(resolve => { releaseRead = resolve; }); currentJob = { jobKey: 'job', videoId: 'video', segments: [{ id: 0, startMs: 0, endMs: 4000, ready: true }] }; applied = true;`);
  const sync = e.run(`syncDub({ videoId: 'video', currentTime: 1, paused: false })`);
  await e.run('stopAll()');
  e.run(`releaseRead({ blob: new Blob(['audio']) })`);
  await sync;
  assert.equal(e.run('audioLanes.size'), 0); assert.equal(e.run('applied'), false);
  assert.equal(e.run('currentStatus.phase'), 'idle');
});
test('stop during translation cannot publish completion or start paid synthesis', async () => {
  const e = engine();
  e.run(`getSettings = async () => ({ fishVoiceId: 'voice', fishApiKeys:['mock'] }); makeJobKey = async () => 'job'; idbGet = async () => null; let releaseTranslation; groqTranslateGroups = () => new Promise(r => { releaseTranslation = r; }); let ttsCalls = 0; fishTts = async () => { ttsCalls++; return new Blob(['audio']); };`);
  const pending = e.run(`prepareCaptionJob({ videoId: 'video', voiceId: 'voice', sourceMode: 'youtube-captions-groq-translate', needsTranslation: true, segments: [{id:0,startMs:0,endMs:2000,text:'Hello'}] })`);
  await new Promise(resolve => setImmediate(resolve));
  await e.run('stopAll()');
  e.run(`releaseTranslation([{id:0,startMs:0,endMs:2000,text:'سلام'}])`);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(e.run('ttsCalls'), 0); assert.equal(e.run('currentStatus.phase'), 'idle');
});
test('translation rejects duplicate IDs and missing entries', async () => {
  const e = engine();
  e.run(`fetchGroqWithRetry = async () => ({ ok: true, json: async () => ({ choices: [{message:{content: JSON.stringify({items:[{id:0,text:'سلام'},{id:0,text:'سلام'}]})}}] }) });`);
  await assert.rejects(e.run(`groqTranslateBatch([{id:0},{id:1}], {groqApiKey:'test'})`), /تکراری/);
});
test('partial cache retries only missing audio and ends with accurate progress', async () => {
  const e = engine();
  e.run(`getSettings = async () => ({ fishVoiceId: 'voice', fishApiKeys:['mock'] }); makeJobKey = async () => 'job'; let ttsIds = []; const cached = { jobKey:'job', videoId:'video', voiceId:'voice', segments:[{id:0,startMs:0,endMs:2000,text:'سلام',ready:true},{id:1,startMs:2000,endMs:4000,text:'خوبی',ready:true}] }; idbGet = async (store,key) => store==='jobs' ? cached : key==='job:0' ? {blob:new Blob(['audio'])} : null; idbPut = async () => {}; fishTts = async segment => { ttsIds.push(segment.id); return new Blob(['audio']); };`);
  await e.run(`prepareCaptionJob({videoId:'video',voiceId:'voice',sourceMode:'youtube-captions',segments:[]})`);
  assert.equal(e.run('ttsIds.join()'), '1');
  assert.equal(e.run('currentStatus.progress.overallPercent'), 100);
});
test('speaker synthesis uses configured voice instead of the default', async () => {
  const e = engine();
  e.run(`let sentVoice; fetch = async (url,init) => { sentVoice = JSON.parse(init.body).reference_id; return {ok:true,headers:new Headers({'content-type':'audio/mpeg'}),blob:async()=>new Blob(['x'.repeat(200)])}; };`);
  e.Headers = Headers;
  await e.run(`fishTts({text:'سلام',speaker:1},{fishApiKeys:['test'],fishVoiceId:'default',autoSpeakerVoices:true,speakerVoices:['first','second']})`);
  assert.equal(e.run('sentVoice'), 'second');
});
test('Deepgram integration asks for diarization and rejects an unlabelled response', async () => {
  const e = engine();
  e.run(`let sentUrl; fetchGroqWithRetry = async url => { sentUrl = url; return {ok:true,json:async()=>({results:{utterances:[]}})}; };`);
  await assert.rejects(e.run(`deepgramTranscribe(new Blob(['audio']),{deepgramApiKey:'test'})`), /گوینده/);
  assert.match(e.run('sentUrl'), /diarize_model=latest/);
});

test('stop interrupts a provider rate-limit wait immediately', async () => {
  const e = engine();
  e.run(`const waitingController = new AbortController();`);
  const wait = e.run(`sleep(60000, waitingController.signal)`);
  e.run('waitingController.abort()');
  await assert.rejects(wait, { name: 'AbortError' });
});

test('whole-file workflow submits audio once and keeps speaker IDs across the file', async () => {
  const e = engine();
  e.run(`getSettings = async () => ({deepgramApiKey:'dg',groqApiKey:'g',fishApiKeys:['f'],fishVoiceId:'default',autoSpeakerVoices:true,speakerVoices:['alice','bob']}); StudioDB.get = async () => ({blob:new Blob(['source']),name:'conversation.mp4'}); makeJobKey = async () => 'file-job'; idbGet = async () => null; idbPut = async () => {}; let transcriptionRequests = 0; deepgramTranscribe = async () => {transcriptionRequests++;return [{speaker:0,start:0,end:1,transcript:'hello'},{speaker:1,start:1,end:2,transcript:'yes'},{speaker:0,start:20,end:21,transcript:'again'}];}; groqTranslateBatch = async items => items.map(item=>({id:item.id,text:'ترجمه '+item.id})); let generatedVoices=[]; fishTts = async segment => {generatedVoices.push(segment.voiceId);return new Blob(['audio']);};`);
  await e.run(`prepareFileJob('source-key')`);
  assert.equal(e.run('transcriptionRequests'),1);
  assert.equal(e.run('currentJob.segments.map(s=>s.speaker).join()'),'0,1,0');
  assert.equal(e.run('generatedVoices.join()'),'alice,bob,alice');
  assert.equal(e.run('currentStatus.progress.overallPercent'),100);
});
test('editing one sentence invalidates only that audio and rejects stale revisions', async () => {
  const e=engine();
  e.run(`currentJob={jobKey:'job',videoId:'v',voiceId:'voice',revision:0,segments:[{id:0,startMs:0,endMs:1000,text:'سلام',ready:true},{id:1,startMs:1000,endMs:2000,text:'خوبی',ready:true}]}; currentStatus.phase='ready'; let removed=[]; idbDelete=async(store,key)=>removed.push(key); idbPut=async()=>{};`);
  await e.run(`editStudioSegment({jobKey:'job',revision:0,segmentId:0,text:'درود',voiceId:'voice',startMs:0,endMs:1000})`);
  assert.equal(e.run('removed.join()'),'job:0');
  assert.equal(e.run('currentJob.segments[1].ready'),true);
  await assert.rejects(e.run(`editStudioSegment({jobKey:'job',revision:0,segmentId:1,text:'سلام',voiceId:'voice',startMs:1000,endMs:2000})`), /نسخه/);
});
test('timing-only edit keeps existing voice audio and invalidates mixed export', async () => {
  const e=engine();
  e.run(`currentJob={jobKey:'job',voiceId:'voice',segments:[{id:0,startMs:0,endMs:1000,text:'سلام',ready:true}]}; currentStatus.phase='ready'; let deletedAudio=0,deletedExport=0; idbDelete=async()=>deletedAudio++; StudioDB.remove=async()=>deletedExport++; idbPut=async()=>{};`);
  await e.run(`editStudioSegment({jobKey:'job',revision:0,segmentId:0,text:'سلام',voiceId:'voice',startMs:100,endMs:1100})`);
  assert.equal(e.run('deletedAudio'),0);assert.equal(e.run('deletedExport'),2);assert.equal(e.run('currentJob.segments[0].ready'),true);
});
test('regeneration only synthesizes the selected sentence', async () => {
  const e=engine();
  e.run(`currentJob={jobKey:'job',voiceId:'voice',revision:0,segments:[{id:0,startMs:0,endMs:1000,text:'سلام',ready:true},{id:1,startMs:1000,endMs:2000,text:'خوبی',ready:true}]};currentStatus.phase='ready';idbPut=async()=>{};getSettings=async()=>({});let synthesized=[];fishTts=async segment=>{synthesized.push(segment.id);return new Blob(['audio']);};`);
  await e.run(`regenerateStudio({jobKey:'job',segmentId:1})`);
  assert.equal(e.run('synthesized.join()'),'1');assert.equal(e.run('currentJob.segments[0].ready'),true);
});
test('glossary context covers the end of long projects; pronunciation keeps source intact', () => {
  const groups=Array.from({length:300},(_,i)=>({speaker:i%2,text:`turn-${i} `+'long '.repeat(100)}));
  const context=core.context(groups,2000);assert.ok(context.length<=2000);assert.match(context,/turn-299/);
  const text='OpenAI و OpenAI';assert.equal(core.pronounce(text,'OpenAI = اوپن ای آی'),'اوپن ای آی و اوپن ای آی');assert.equal(text,'OpenAI و OpenAI');
});
test('offline time fitting shortens speech while approximately retaining local pitch', () => {
  const renderer=require('../audio-render.js'),rate=24000;
  const original=Float32Array.from({length:rate},(_,i)=>.4*Math.sin(2*Math.PI*440*i/rate));
  const stretched=renderer.stretch(original,1.5,rate);assert.equal(stretched.length,16000);
  let crossings=0;for(let i=1001;i<stretched.length-1000;i++)if(stretched[i-1]<=0&&stretched[i]>0)crossings++;
  const frequency=crossings/((stretched.length-2000)/rate);assert.ok(Math.abs(frequency-440)<20,`frequency ${frequency}`);
});
test('WAV export mixes overlapping speech, limits clipping, and writes valid PCM headers', async () => {
  const renderer=require('../audio-render.js'),mix=new Float32Array(8);renderer.mix(mix,new Float32Array([.8,.8,.8]),0);renderer.mix(mix,new Float32Array([.8,.8]),1);
  assert.ok(mix[1]>1);const blob=renderer.wav(mix,24000),data=await blob.arrayBuffer(),view=new DataView(data);
  assert.equal(Buffer.from(data).subarray(0,4).toString(),'RIFF');assert.equal(view.getUint32(24,true),24000);assert.equal(view.getUint32(40,true),16);assert.ok(view.getInt16(46,true)<32767);
});

test('WebM metadata repair inserts the real duration without reading the whole video', async () => {
  const audio=require('../audio-render.js');
  // Unknown-size Segment followed by an empty Info and a minimal Tracks element.
  const original=new Blob([Uint8Array.from([0x18,0x53,0x80,0x67,0x01,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x15,0x49,0xa9,0x66,0x80,0x16,0x54,0xae,0x6b,0x80])],{type:'video/webm'});
  const fixed=await audio.webmDuration(original,3),bytes=new Uint8Array(await fixed.arrayBuffer());
  assert.equal(fixed.size,original.size+11);assert.equal(bytes[16],0x8b);assert.equal(new DataView(bytes.buffer).getFloat64(20),3000);
});

test('studio mutation lock prevents simultaneous editors from overwriting revisions', async () => {
  const e=engine();e.run('let releaseEdit;');
  const first=e.run(`withStudioMutation(()=>new Promise(resolve=>releaseEdit=resolve))`);
  await assert.rejects(e.run(`withStudioMutation(async()=>({ok:true}))`),/عملیات/);
  e.run('releaseEdit({ok:true})');await first;
  assert.equal(e.run('currentStudioTask'),null);
});
