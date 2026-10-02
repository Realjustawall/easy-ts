/* Runs in the offscreen document; shares the existing engine's job ownership. */
let currentStudioTask = null;
async function withStudioMutation(work) {
  if (currentStudioTask) throw new Error('عملیات دیگری در حال انجام است.');
  const token = {}; currentStudioTask = token;
  try { return await work(); }
  finally { if (currentStudioTask === token) currentStudioTask = null; }
}
function launchStudioTask(work) {
  if (currentStudioTask) throw new Error('عملیات دیگری در حال انجام است؛ ابتدا توقف را بزنید.');
  const token = {};
  currentStudioTask = token;
  Promise.resolve().then(work).catch(async error => {
    if (currentStudioTask === token && error.name !== 'AbortError') await notifyStatus({ phase: 'error', error: error.message, label: 'عملیات استودیو ناموفق بود.' });
  }).finally(() => { if (currentStudioTask === token) currentStudioTask = null; });
  return { ok: true };
}
function studioBusy() { return ['starting', 'transcribing', 'translating', 'generating', 'capturing', 'exporting'].includes(currentStatus.phase); }
function requireStudioJob(jobKey) {
  if (!currentJob || currentJob.jobKey !== jobKey) throw new Error('پروژه تغییر کرده است؛ فهرست جمله‌ها را تازه کنید.');
  return currentJob;
}
async function publishJob(job, patch = {}) {
  await notifyStatus({ jobKey: job.jobKey, title: job.title, videoId: job.videoId, sourceMode: job.sourceMode,
    totalSegments: job.segments.length, translatedSegments: job.segments.filter(s => s.translated !== false).length,
    readySegments: job.segments.filter(s => s.ready).length, failedSegments: job.segments.filter(s => s.failed).length, ...patch });
}

async function prepareFileJob(sourceKey) {
  await stopAll();
  const epoch = runEpoch;
  const controller = new AbortController();
  currentAbortController = controller;
  currentJob = null;
  runStartedAt = Date.now();
  await notifyStatus({ phase: 'starting', sourceMode: 'file', title: '', jobKey: null, videoId: '', totalSegments: 0, translatedSegments: 0, readySegments: 0, failedSegments: 0, applied: false, error: null, label: 'آماده‌سازی فایل کامل…' });
  const settings = await getSettings();
  assertRun(epoch);
  EasyTsProviders.check(settings,'stt');EasyTsProviders.check(settings,'translation');EasyTsProviders.check(settings,'tts');
  playbackSettings = settings;
  const source = await StudioDB.get('sources', sourceKey);
  assertRun(epoch);
  if (!source?.blob || !source.blob.size || source.blob.size > 200 * 1024 * 1024) throw new Error('فایل موجود نیست یا حجم آن بیشتر از ۲۰۰ مگابایت است.');
  const jobKey = await makeJobKey({ videoId: `file:${sourceKey}`, voiceId: normalizeFishVoiceId(EasyTsProviders.voice(settings)), sourceMode: 'file', needsTranslation: true, segments: [] });
  let job = await idbGet('jobs', jobKey);
  assertRun(epoch);
  if (!job) {
    await notifyStatus({ phase: 'transcribing', title: source.name, label: 'تشخیص گوینده در کل فایل؛ این مرحله ممکن است چند دقیقه طول بکشد…' });
    const utterances = await deepgramTranscribe(source.blob, settings, controller.signal, 600000);
    assertRun(epoch);
    const groups = EasyTsCore.normalizeUtterances(utterances, { startVideoSec: 0, playbackRate: 1, scope: 'file' }, Number(settings.chunkMaxSec || 12), Number(settings.chunkMaxChars || 220));
    if (!groups.length) throw new Error('گفتار زمان‌بندی‌شده‌ای در فایل پیدا نشد.');
    job = { jobKey, ttsProvider:settings.ttsProvider||'fish',videoId: `file:${sourceKey}`, sourceKey, sourceMode: 'file', title: source.name, voiceId: normalizeFishVoiceId(EasyTsProviders.voice(settings)), createdAt: Date.now(), revision: 0,
      segments: groups.map((s, id) => ({ ...s, id, sourceText: s.text, translated: false, ready: false, failed: false,
        voiceId: normalizeFishVoiceId(EasyTsProviders.speakerVoice(settings,s.speaker) || EasyTsProviders.voice(settings)) })) };
    await persistJob(job);
  }
  assertRun(epoch);
  currentJob = job;
  sourceMode = 'file';
  for (const segment of job.segments.filter(s => s.ready)) {
    if (!(await idbGet('audio', `${jobKey}:${segment.id}`))?.blob) segment.ready = false;
    assertRun(epoch);
  }
  const untranslated = job.segments.filter(s => s.translated === false);
  if (untranslated.length) {
    await publishJob(job, { phase: 'translating', error: null, label: 'ترجمه با زمینهٔ گفت‌وگو و واژه‌نامه…' });
    const translationSettings = { ...settings, projectContext: EasyTsCore.context(job.segments) };
    await groqTranslateGroups(untranslated.map(s => ({ ...s, text: s.sourceText })), translationSettings, controller.signal, async (_, result) => {
      assertRun(epoch);
      for (const item of result) { const segment = untranslated[item.id]; segment.text = item.text.trim(); segment.translated = true; }
      await persistJob(job);
      assertRun(epoch);
      await publishJob(job);
    });
  }
  assertRun(epoch);
  await synthesizeStudioSegments(job, job.segments.filter(s => !s.ready), settings, epoch, controller.signal);
}

async function synthesizeStudioSegments(job, segments, settings, epoch, signal) {
  runStartedAt = Date.now();
  await publishJob(job, { phase: 'generating', initialReady: job.segments.filter(s => s.ready).length, error: null, label: 'ساخت صدای جمله‌ها…' });
  const synthesize = async segment => {
    assertRun(epoch);
    try {
      const blob = await fishTts(segment, settings, signal, segment.voiceId || job.voiceId);
      assertRun(epoch);
      await idbPut('audio', { key: `${job.jobKey}:${segment.id}`, jobKey: job.jobKey, videoId: job.videoId, segmentId: segment.id, blob, size: blob.size, createdAt: Date.now() });
      assertRun(epoch);
      segment.audioDuration = await measureSpeech(blob);
      assertRun(epoch);
      segment.ready = true; segment.failed = false; segment.error = null;
    } catch (error) {
      if (epoch !== runEpoch || error.name === 'AbortError') throw error;
      segment.ready = false; segment.failed = true; segment.error = error.message;
    }
    await persistJob(job);
    assertRun(epoch);
    await publishJob(job);
  };
  // Validate one real request before opening a paid concurrent pool.
  if (segments.length) {
    await synthesize(segments[0]);
    if (!segments[0].ready) {
      await publishJob(job, { phase: 'partial', label: 'ساخت جملهٔ اول ناموفق بود؛ تنظیمات صدا را بررسی کنید.', error: segments[0].error });
      return;
    }
  }
  await processPool(segments.slice(1), clamp(Number(settings.fishConcurrency || 5), 1, 10), synthesize);
  assertRun(epoch);
  if (currentAbortController?.signal === signal) currentAbortController = null;
  const failed = job.segments.find(s => s.failed);
  await publishJob(job, { phase: failed ? 'partial' : 'ready', error: failed?.error || null, label: failed ? 'بخشی از صداها خطا دارند؛ می‌توانید فقط همان جمله‌ها را بازسازی کنید.' : 'پروژه آمادهٔ بازبینی و خروجی است.' });
}

async function editStudioSegment(message) {
  const job = requireStudioJob(message.jobKey);
  if (studioBusy()) throw new Error('برای ویرایش ابتدا پردازش را متوقف کنید.');
  if ((job.revision || 0) !== message.revision) throw new Error('نسخهٔ پروژه تغییر کرده است؛ دوباره فهرست را دریافت کنید.');
  const segment = job.segments.find(s => s.id === message.segmentId);
  if (!segment) throw new Error('جمله پیدا نشد.');
  const text = String(message.text || '').trim(), voiceId = normalizeFishVoiceId(message.voiceId || job.voiceId);
  if (!text || text.length > 3000 || !voiceId || /\s/.test(voiceId) || voiceId.length > 180) throw new Error('متن یا شناسهٔ صدا معتبر نیست.');
  const startMs = Number(message.startMs), endMs = Number(message.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || endMs > 24 * 3600000) throw new Error('زمان شروع و پایان معتبر نیست.');
  await stopDubAudio();
  applied = false;
  // Invalidate audio only when its spoken text or voice changes.
  if (segment.text !== text || (segment.voiceId || job.voiceId) !== voiceId) {
    segment.ready = false; segment.failed = false; segment.error = null; segment.audioDuration = null;
    await idbDelete('audio', `${job.jobKey}:${segment.id}`);
  }
  Object.assign(segment, { text, voiceId, startMs, endMs, translated: true });
  job.segments.sort((a, b) => a.startMs - b.startMs);
  job.revision = (job.revision || 0) + 1;
  await StudioDB.remove('exports', job.jobKey);
  await StudioDB.remove('exports', `video:${job.jobKey}`);
  await persistJob(job);
  await publishJob(job, { applied: false, phase: job.segments.every(s => s.ready) ? 'ready' : 'partial', label: 'ویرایش ذخیره شد؛ صدای متن تغییرکرده باید بازسازی شود.', error: null });
  return { ok: true, revision: job.revision };
}

async function regenerateStudio(message) {
  const job = requireStudioJob(message.jobKey);
  if (studioBusy()) throw new Error('ابتدا پردازش قبلی را متوقف کنید.');
  if (job.segments.some(s => s.translated === false)) throw new Error('ترجمهٔ پروژه کامل نشده است؛ فایل را دوباره پردازش کنید.');
  await stopAll();
  const epoch = runEpoch;
  const settings = await getSettings();
  assertRun(epoch);
  const segments = message.segmentId == null ? job.segments.filter(s => !s.ready) : job.segments.filter(s => s.id === message.segmentId);
  if ((job.ttsProvider||'fish') !== (settings.ttsProvider||'fish')) throw new Error('سرویس صدای پروژه با تنظیمات فعلی متفاوت است؛ سرویس قبلی را انتخاب کنید یا فایل را با تنظیمات جدید پردازش کنید.');
  if (message.segmentId != null && !segments.length) throw new Error('جمله پیدا نشد.');
  for (const segment of segments) { segment.ready = false; segment.failed = false; segment.error = null; }
  job.revision = (job.revision || 0) + 1;
  await StudioDB.remove('exports', job.jobKey);
  await StudioDB.remove('exports', `video:${job.jobKey}`);
  await persistJob(job);
  assertRun(epoch);
  const controller = new AbortController(); currentAbortController = controller;
  await synthesizeStudioSegments(job, segments, settings, epoch, controller.signal);
}

async function restoreStudioJob(jobKey) {
  if (studioBusy()) throw new Error('ابتدا پردازش فعلی را متوقف کنید.');
  const job = await idbGet('jobs', jobKey);
  if (!job) throw new Error('پروژه در کش پیدا نشد.');
  await stopAll();
  const epoch = runEpoch;
  currentJob = job;
  currentJob.revision ||= 0;
  for (const segment of job.segments.filter(s => s.ready)) {
    if (!(await idbGet('audio', `${job.jobKey}:${segment.id}`))?.blob) segment.ready = false;
    assertRun(epoch);
  }
  await persistJob(job);
  assertRun(epoch);
  await publishJob(job, { phase: job.segments.every(s => s.ready) ? 'ready' : 'partial', applied: false, error: null, label: 'پروژه از کش باز شد.' });
  return { ok: true };
}

async function configureStudioMix(message) {
  const job = requireStudioJob(message.jobKey);
  const epoch=runEpoch;
  if (studioBusy() || (job.revision || 0) !== message.revision) throw new Error('پروژه مشغول است یا نسخه تغییر کرده؛ دوباره دریافت کنید.');
  const gain = Number(message.gain), duck = Number(message.duck);
  if (!Number.isFinite(gain) || gain < 0 || gain > 2 || !Number.isFinite(duck) || duck < 0 || duck > 1) throw new Error('بلندی پس‌زمینه نامعتبر است.');
  if (message.backgroundKey) {
    const record = await StudioDB.get('sources',message.backgroundKey);
    assertRun(epoch);
    if (!record?.blob?.size || record.blob.size > 200*1024*1024) throw new Error('ترک پس‌زمینه موجود نیست یا بیش از ۲۰۰ مگابایت است.');
  }
  job.background = message.backgroundKey ? { key:message.backgroundKey, gain, duck } : null;
  job.revision = (job.revision || 0)+1;
  await StudioDB.remove('exports',job.jobKey); await StudioDB.remove('exports',`video:${job.jobKey}`);
  await persistJob(job); await publishJob(job,{error:null});
  return {ok:true,revision:job.revision};
}

async function assignStudioVoice(message) {
  const job = requireStudioJob(message.jobKey);
  const epoch=runEpoch;
  if (studioBusy() || (job.revision || 0) !== message.revision) throw new Error('پروژه مشغول است یا نسخه تغییر کرده؛ دوباره دریافت کنید.');
  const voice = normalizeFishVoiceId(String(message.voiceId || '').trim());
  if (!voice || /\s/.test(voice) || voice.length>180) throw new Error('Voice ID معتبر وارد کنید.');
  const segments = job.segments.filter(s => `${s.speakerScope}:${s.speaker}` === message.speakerKey);
  if (!segments.length) throw new Error('گوینده پیدا نشد.');
  await stopDubAudio(); assertRun(epoch); applied=false;
  let changed = 0;
  for (const s of segments) if ((s.voiceId || job.voiceId) !== voice) {
    await idbDelete('audio',`${job.jobKey}:${s.id}`);
    assertRun(epoch);
    s.voiceId=voice; s.ready=false; s.failed=false; s.error=null; s.audioDuration=null; changed++;
  }
  if (changed) {
    job.revision=(job.revision || 0)+1;
    await StudioDB.remove('exports',job.jobKey); await StudioDB.remove('exports',`video:${job.jobKey}`);
    await persistJob(job); await publishJob(job,{phase:'partial',error:null,label:'صدای گوینده تغییر کرد؛ جمله‌های او را دوباره بسازید.'});
  }
  return {ok:true,revision:job.revision,changed};
}

async function renderStudioAudio(message) {
  const job = requireStudioJob(message.jobKey);
  if (studioBusy()) throw new Error('ابتدا پردازش فعلی را تمام یا متوقف کنید.');
  if (!job.segments.length || job.segments.some(s => !s.ready)) throw new Error('برای خروجی صوتی، تمام جمله‌ها باید صدا داشته باشند.');
  await ensureSpeechDurations(job);
  const timeline = EasyTsCore.sequentialTimeline(job.segments);
  let duration = Math.max(...timeline.map(s => s.endMs)) / 1000;
  if (duration > 1200) throw new Error('خروجی صوتی مرورگر فعلاً تا ۲۰ دقیقه پشتیبانی می‌شود.');
  await stopAll();
  const epoch = runEpoch, revision = job.revision || 0, sampleRate = 24000;
  await publishJob(job, { phase: 'exporting', label: 'ساخت فایل صوتی روی مرورگر…', exportPercent: 0 });
  const decoder = new AudioContext({ sampleRate });
  try {
    let backgroundAudio = null;
    if (job.background?.key) {
      const record = await StudioDB.get('sources',job.background.key);
      assertRun(epoch);
      if (!record?.blob) throw new Error('ترک پس‌زمینه پیدا نشد؛ دوباره وارد کنید.');
      backgroundAudio = await decoder.decodeAudioData(await record.blob.arrayBuffer());
      assertRun(epoch);
      duration = Math.max(duration,backgroundAudio.duration);
      if (duration>1200) throw new Error('ترک پس‌زمینه باید حداکثر ۲۰ دقیقه باشد.');
    }
    const mix = new Float32Array(Math.ceil(duration * sampleRate));
    for (let i = 0; i < job.segments.length; i++) {
      assertRun(epoch);
      const segment = timeline[i], record = await idbGet('audio', `${job.jobKey}:${segment.id}`);
      if (!record?.blob) throw new Error('فایل صوتی یکی از جمله‌ها در کش وجود ندارد؛ آن جمله را بازسازی کنید.');
      const decoded = await decoder.decodeAudioData(await record.blob.arrayBuffer());
      assertRun(epoch);
      const mono = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const data = decoded.getChannelData(channel);
        for (let j = 0; j < mono.length; j++) mono[j] += data[j] / decoded.numberOfChannels;
      }
      const slot = (segment.endMs - segment.startMs) / 1000;
      const rate = Math.max(1, decoded.duration / slot);
      if (rate > 4) throw new Error(`متن جملهٔ ${segment.id + 1} بیش از حد بلند است؛ متن را کوتاه یا زمان پایان را اصلاح کنید.`);
      const fitted = EasyTsAudio.stretch(mono, rate, sampleRate);
      EasyTsAudio.mix(mix, fitted, segment.startMs / 1000 * sampleRate);
      await publishJob(job, { exportPercent: Math.round((i + 1) / job.segments.length * 100) });
      await sleep(0);
    }
    assertRun(epoch);
    if (backgroundAudio) {
      const samples = new Float32Array(backgroundAudio.length);
      for (let channel=0;channel<backgroundAudio.numberOfChannels;channel++) {
        const data=backgroundAudio.getChannelData(channel);
        for(let i=0;i<samples.length;i++)samples[i]+=data[i]/backgroundAudio.numberOfChannels;
      }
      EasyTsAudio.background(mix,samples,sampleRate,timeline,job.background.gain,job.background.duck);
    }
    const blob = EasyTsAudio.wav(mix, sampleRate);
    await StudioDB.put('exports', { key: job.jobKey, revision, timelineVersion: 2, blob, createdAt: Date.now() });
    assertRun(epoch);
    await publishJob(job, { phase: 'ready', label: 'فایل WAV آمادهٔ دریافت است.', exportPercent: 100 });
    return { ok: true, exportKey: job.jobKey };
  } finally { await decoder.close().catch(() => {}); }
}

async function renderStudioVideo(message) {
  const job = requireStudioJob(message.jobKey);
  if (studioBusy()) throw new Error('ابتدا عملیات قبلی را تمام یا متوقف کنید.');
  const source = job.sourceKey ? await StudioDB.get('sources', job.sourceKey) : null;
  const rendered = await StudioDB.get('exports', job.jobKey);
  if (!source?.blob || !(/video\//.test(source.blob.type) || /\.(mp4|webm|mov)$/i.test(source.name))) throw new Error('خروجی ویدیویی به فایل ویدیویی اصلی نیاز دارد.');
  if (!rendered?.blob || rendered.timelineVersion !== 2 || rendered.revision !== (job.revision || 0)) throw new Error('ابتدا فایل WAV آخرین نسخهٔ پروژه را بسازید.');
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('مرورگر امکان ساخت ویدیوی WebM را ندارد.');
  await stopAll();
  const epoch = runEpoch, controller = new AbortController(); currentAbortController = controller;
  const video = document.createElement('video'), audio = document.createElement('audio');
  const videoUrl = URL.createObjectURL(source.blob), audioUrl = URL.createObjectURL(rendered.blob);
  video.src = videoUrl; video.muted = true; video.preload = 'auto'; audio.src = audioUrl; audio.preload = 'auto';
  const context = new AudioContext(), destination = context.createMediaStreamDestination();
  context.createMediaElementSource(audio).connect(destination);
  let stream, recorder, progressTimer, frameTimer;
  const waitLoaded = element => new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(new Error('مرورگر نتوانست فایل اصلی را باز کند.')); }, abort = () => { cleanup(); reject(controller.signal.reason); };
    const timer = setTimeout(fail, 30000);
    const cleanup = () => { clearTimeout(timer); element.removeEventListener('loadeddata',done); element.removeEventListener('error',fail); controller.signal.removeEventListener('abort',abort); };
    element.addEventListener('loadeddata',done,{once:true});element.addEventListener('error',fail,{once:true});controller.signal.addEventListener('abort',abort,{once:true});
    if(element.readyState>=2)done();
  });
  try {
    await publishJob(job,{phase:'exporting',exportPercent:0,label:'ساخت ویدیوی WebM در زمان واقعی؛ این مرحله به اندازهٔ مدت ویدیو طول می‌کشد.'});
    await Promise.all([waitLoaded(video),waitLoaded(audio)]);
    assertRun(epoch);
    if (!Number.isFinite(video.duration) || video.duration > 1200) throw new Error('خروجی ویدیویی مرورگر فعلاً تا ۲۰ دقیقه پشتیبانی می‌شود.');
    // Retain the final image while serialized dialogue finishes after the source video.
    const outputDuration = Math.max(video.duration, audio.duration);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const painter = canvas.getContext('2d');
    const draw = () => painter.drawImage(video, 0, 0, canvas.width, canvas.height);
    draw(); frameTimer = setInterval(draw, 1000 / 30);
    const videoStream = canvas.captureStream(30);
    const tracks = videoStream.getVideoTracks();
    if (!tracks.length) throw new Error('مرورگر مسیر تصویری قابل ضبط برنگرداند.');
    stream = new MediaStream([...tracks,...destination.stream.getAudioTracks()]);
    recorder = new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4000000,audioBitsPerSecond:192000});
    const chunks = []; let size = 0;
    const recording = new Promise((resolve,reject) => {
      const abort = () => { if(recorder.state!=='inactive')recorder.stop();reject(controller.signal.reason); };
      controller.signal.addEventListener('abort',abort,{once:true});
      recorder.ondataavailable = event => { if(event.data.size){size+=event.data.size;if(size>300*1024*1024){if(recorder.state!=='inactive')recorder.stop();reject(new Error('خروجی از سقف ۳۰۰ مگابایت حافظهٔ مرورگر عبور کرد.'));return;}chunks.push(event.data);} };
      recorder.onerror = () => reject(new Error('ضبط خروجی ویدیویی ناموفق بود.'));
      recorder.onstop = () => {controller.signal.removeEventListener('abort',abort);resolve(new Blob(chunks,{type:mimeType}));};
      const finish = () => { if(video.ended && audio.ended && recorder.state!=='inactive')recorder.stop(); };
      video.onended = finish; audio.onended = finish;
      video.onerror = () => {if(recorder.state!=='inactive')recorder.stop();reject(new Error('خواندن تصویر ویدیو ناموفق بود.'));};
    });
    recorder.start(1000);
    // Attach a handler immediately, including if media playback fails before awaiting it.
    recording.catch(()=>{});
    await context.resume();
    await Promise.all([video.play(),audio.play()]);
    progressTimer=setInterval(()=>{if(epoch===runEpoch)notifyStatus({exportPercent:Math.min(99,Math.round(video.currentTime/video.duration*100))}).catch(()=>{});},1000);
    const recorded=await recording;
    const blob=await EasyTsAudio.webmDuration(recorded,outputDuration);
    assertRun(epoch);
    await StudioDB.put('exports',{key:`video:${job.jobKey}`,revision:job.revision||0,timelineVersion:2,blob,createdAt:Date.now()});
    assertRun(epoch);
    await publishJob(job,{phase:'ready',exportPercent:100,error:null,label:'ویدیوی دوبله‌شدهٔ WebM آمادهٔ دریافت است.'});
    if(currentAbortController===controller)currentAbortController=null;
    return {ok:true};
  } finally {
    clearInterval(progressTimer);clearInterval(frameTimer);video.pause();audio.pause();
    if(recorder?.state!=='inactive')try{recorder?.stop();}catch{}
    for(const track of stream?.getTracks()||[])track.stop();
    await context.close().catch(()=>{});URL.revokeObjectURL(videoUrl);URL.revokeObjectURL(audioUrl);
  }
}
