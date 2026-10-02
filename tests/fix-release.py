from pathlib import Path
def edit(name, old, new):
 p=Path(name); s=p.read_text(encoding='utf-8'); assert old in s,(name,old); p.write_text(s.replace(old,new),encoding='utf-8')
edit('content.js','return cues;','return EasyTsCore.normalizeCaptions(cues);')
edit('content.js',"const CONTENT_VERSION = '1.5.0'","const CONTENT_VERSION = '1.5.1'")
edit('manifest.json','"version": "1.5.0"','"version": "1.5.1"')
edit('manifest.json','"provider-config.js",','"provider-config.js",\n        "engine-core.js",')
edit('background.js',"files: ['provider-config.js','content.js']","files: ['provider-config.js','engine-core.js','content.js']")
edit('background.js',"if (!message || message.target === 'offscreen') return false;","if (!message || message.target === 'offscreen' || message.target === 'popup') return false;")
edit('background.js','async function ensureOffscreen() {','let offscreenCreation = null;\nasync function ensureOffscreen() {\n  if (!offscreenCreation) offscreenCreation = createOffscreenIfMissing().finally(() => { offscreenCreation = null; });\n  return offscreenCreation;\n}\nasync function createOffscreenIfMissing() {')
edit('provider-config.js',"ttsProvider:'fish',","autoSpeakerVoices:false,ttsProvider:'fish',")
edit('provider-config.js',"function speakerVoice(s,id){const key=","function speakerVoice(s,id){if(!s.autoSpeakerVoices || id == null || !Number.isInteger(Number(id)) || Number(id)<0)return '';const key=")
edit('settings-schema.js',"check('speakerMode',","check('autoSpeakerVoices','انتخاب خودکار صدا برای هر گوینده','اختیاری: هر خط فهرست صداها برای یک گوینده است. گویندهٔ بدون Voice ID از صدای پیش‌فرض استفاده می‌کند. برای YouTube، تشخیص گوینده هنگام ضبط را هم فعال کنید.'),check('speakerMode',")
edit('offscreen.js',"(segment.speaker != null ? settings.speakerVoices?.[Number(segment.speaker)] : '')","EasyTsProviders.speakerVoice(settings, segment.speaker)")
edit('offscreen.js','const active = EasyTsCore.activeSegments(job.segments, state.currentTime * 1000);','const timeline = EasyTsCore.sequentialTimeline(job.segments, playbackSettings.maxTimeStretch);\n  const active = EasyTsCore.activeSegments(timeline, state.currentTime * 1000);\n  // Pause before asynchronous loads so the previous turn cannot continue into the next.\n  for (const [id, lane] of audioLanes) if (state.paused || !active.some(s => s.id === id)) lane.audio.pause();')
edit('offscreen.js','// Preload the next two turns; each turn owns an Audio element, including overlaps.','// Preload without playing; the sequential timeline permits only one speaking turn.')
edit('offscreen.js','const upcoming = job.segments.filter','const upcoming = timeline.filter')
edit('offscreen.js','if (applied && currentJob === job && error.name', 'if (serial === syncSerial && applied && currentJob === job && error.name')
edit('offscreen.js',"notifyStatus({ error: 'پخش صدا ناموفق بود؛ دوبله را دوباره اعمال کنید.' });","notifyStatus({ error: 'پخش صدا ناموفق بود؛ دوبله را دوباره اعمال کنید.' }).catch(() => {});")
edit('offscreen.js','async function syncDub(state) {', '''async function measureSpeech(blob) {
  const audio = new Audio();
  let loaded;
  try { loaded = await loadAudioElement(audio, blob); return loaded.duration; }
  finally { disposeLane({ audio, url: loaded?.url }); }
}

async function syncDub(state) {''')
edit('offscreen.js','first.ready = true;','first.audioDuration = await measureSpeech(blob);\n      assertRun(epoch);\n      first.ready = true;')
# Each synthesis route retains its measured duration before making the turn playable.
p=Path('offscreen.js');s=p.read_text(encoding='utf-8');s=s.replace('segment.ready = true;', 'segment.audioDuration = await measureSpeech(blob);\n      assertRun(epoch);\n      segment.ready = true;')
# The live-window route uses a different blob and epoch.
s=s.replace('blob: audioBlob, size: audioBlob.size, createdAt: Date.now() });\n      segment.audioDuration = await measureSpeech(blob);\n      assertRun(epoch);','blob: audioBlob, size: audioBlob.size, createdAt: Date.now() });\n      segment.audioDuration = await measureSpeech(audioBlob);\n      assertRun(win.epoch);')
p.write_text(s,encoding='utf-8')
edit('studio-engine.js','segment.ready = true;','segment.audioDuration = await measureSpeech(blob);\n      assertRun(epoch);\n      segment.ready = true;')
edit('studio-engine.js','let duration = Math.max(...job.segments.map(s => s.endMs)) / 1000;','const timeline = EasyTsCore.sequentialTimeline(job.segments);\n  let duration = Math.max(...timeline.map(s => s.endMs)) / 1000;')
edit('studio-engine.js','const segment = job.segments[i], record','const segment = timeline[i], record')
edit('studio-engine.js','sampleRate,job.segments,job.background.gain','sampleRate,timeline,job.background.gain')
edit('offscreen.js','EasyTsCore.srt(currentJob.segments)','EasyTsCore.srt(EasyTsCore.sequentialTimeline(currentJob.segments, playbackSettings.maxTimeStretch))')
edit('studio.js','EasyTsCore.srt(project.segments)','EasyTsCore.srt(EasyTsCore.sequentialTimeline(project.segments))')
# Explicit opt-in in existing multi-voice test fixtures.
for name in ['tests/engine.test.cjs','tests/providers.test.cjs']:
 p=Path(name);s=p.read_text(encoding='utf-8');s=s.replace('speakerVoices:', 'autoSpeakerVoices:true,speakerVoices:').replace("elevenSpeakerVoices:['chosen']","autoSpeakerVoices:true,elevenSpeakerVoices:['chosen']")
 if name.endswith('engine.test.cjs'):
  s=s.replace('both overlapping audio lanes play; pause, seek and wrong video stop audio','overlapping turns play sequentially; pause, seek and wrong video stop audio').replace(".filter(l => !l.audio.paused).length`), 2)",".filter(l => !l.audio.paused).length`), 1)").replace('audio.volume < 0.5','audio.volume === 0.5')
 p.write_text(s,encoding='utf-8')
