(() => {
  const CONTENT_VERSION = '1.8.0';
  const CONTENT_SOURCE = 'easy-ts-content-v1.1.3';
  const MAIN_SOURCE = 'easy-ts-main-v1.1.3';
  if (window.__easyTsContentVersion === CONTENT_VERSION) return;
  window.__easyTsContentDispose?.();
  window.__easyTsContentVersion = CONTENT_VERSION;

  let currentVideo = null;
  let currentVideoId = '';
  let sourceMode = null;
  let applied = false;
  let syncTimer = null;
  let statusPill = null;
  const rpcPending = new Map();
  let rpcSeq = 0;
  let disposed = false;
  let navigationEpoch = 0;

  function disposeContent() {
    if (disposed) return;
    disposed = true;
    detachSync();
    if (currentVideo?.dataset?.easyTsWasMuted !== undefined) {
      currentVideo.muted = currentVideo.dataset.easyTsWasMuted === 'true';
      delete currentVideo.dataset.easyTsWasMuted;
    }
    applied = false;
    window.removeEventListener('message', onBridgeMessage);
    window.removeEventListener('yt-navigate-finish', onNavigate);
    window.removeEventListener('yt-page-data-updated', onNavigate);
    window.removeEventListener('popstate', onNavigate);
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch {}
    for (const pending of rpcPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('اتصال افزونه قطع شده است؛ صفحهٔ YouTube را دوباره بارگذاری کنید.'));
    }
    rpcPending.clear();
    statusPill?.remove();
  }
  window.__easyTsContentDispose = disposeContent;

  async function sendRuntime(message) {
    try {
      if (disposed || !chrome.runtime?.id) throw new Error('Extension context invalidated.');
      // sendMessage can throw synchronously after extension reload, before a Promise exists.
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (disposed || /extension context invalidated/i.test(error?.message || '')) {
        disposeContent();
        throw new Error('اتصال افزونه قطع شده است؛ صفحهٔ YouTube را دوباره بارگذاری کنید.');
      }
      throw error;
    }
  }

  async function getSettings() {
    const res = await sendRuntime({ type: 'EASYTS_SETTINGS_GET', target: 'background' });
    if (!res?.ok) throw new Error(res?.error || 'تنظیمات Easy-ts خوانده نشد.');
    return EasyTsProviders.resolve(res.settings || {});
  }

  function rpc(type, payload = {}, timeout = 6000) {
    if (disposed) return Promise.reject(new Error('اتصال افزونه قطع شده است؛ صفحه را دوباره بارگذاری کنید.'));
    return new Promise((resolve, reject) => {
      const requestId = `easyts-${Date.now()}-${++rpcSeq}`;
      const timer = setTimeout(() => {
        rpcPending.delete(requestId);
        reject(new Error('زمان دریافت پاسخ از YouTube تمام شد.'));
      }, timeout);
      rpcPending.set(requestId, { resolve, reject, timer });
      window.postMessage({ source: CONTENT_SOURCE, requestId, type, payload }, '*');
    });
  }

  function onBridgeMessage(event) {
    if (event.source !== window || event.data?.source !== MAIN_SOURCE) return;
    if (event.data.type === 'RPC_REPLY') {
      const pending = rpcPending.get(event.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      rpcPending.delete(event.data.requestId);
      event.data.ok ? pending.resolve(event.data.data) : pending.reject(new Error(event.data.error || 'YouTube RPC error'));
    }
  }
  window.addEventListener('message', onBridgeMessage);

  function getVideo() {
    return document.querySelector('ytd-reel-video-renderer[is-active] video, ytd-reel-video-renderer[active] video') || document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function getVideoId() {
    return new URL(location.href).searchParams.get('v') || new URL(location.href).pathname.match(/^\/shorts\/([^/]+)/)?.[1] || '';
  }

  function cleanText(text) {
    return String(text || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .replace(/♪/g, '')
      .trim();
  }

  function isNonSpeechCue(text) {
    const value = String(text || '').trim().toLowerCase();
    return /^\[(music|applause|laughter|cheering|silence|noise|sound effects?|موسیقی|خنده|تشویق)\]$/.test(value)
      || /^\((music|applause|laughter|silence|noise|موسیقی|خنده)\)$/.test(value);
  }

  function json3ToCues(json) {
    const cues = [];
    for (const e of json?.events || []) {
      if (!e?.segs?.length) continue;
      const text = cleanText(e.segs.map(s => s.utf8 || '').join(''));
      if (!text || isNonSpeechCue(text)) continue;
      const startMs = Number(e.tStartMs || 0);
      const durMs = Math.max(80, Number(e.dDurationMs || 0));
      const cue = { startMs, endMs: startMs + durMs, text };
      const prev = cues[cues.length - 1];
      if (prev && prev.text === cue.text && cue.startMs <= prev.endMs + 250) {
        prev.endMs = Math.max(prev.endMs, cue.endMs);
        continue;
      }
      cues.push(cue);
    }
    return EasyTsCore.normalizeCaptions(cues);
  }

  function splitOversizedCue(cue, maxMs, maxChars) {
    const duration = Math.max(1, cue.endMs - cue.startMs);
    const text = String(cue.text || '').trim();
    if (!text || (duration <= maxMs && text.length <= maxChars)) return [cue];

    const minParts = Math.max(1, Math.ceil(duration / maxMs), Math.ceil(text.length / maxChars));
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [cue];

    const targetChars = Math.max(24, Math.ceil(text.length / minParts));
    const parts = [];
    let buf = [];
    let chars = 0;
    for (const word of words) {
      const nextChars = chars + (buf.length ? 1 : 0) + word.length;
      if (buf.length && nextChars > targetChars && parts.length < minParts - 1) {
        parts.push(buf.join(' '));
        buf = [word];
        chars = word.length;
      } else {
        buf.push(word);
        chars = nextChars;
      }
    }
    if (buf.length) parts.push(buf.join(' '));
    if (parts.length <= 1) return [cue];

    const totalWeight = parts.reduce((sum, part) => sum + Math.max(1, part.length), 0);
    let cursor = cue.startMs;
    return parts.map((part, index) => {
      const isLast = index === parts.length - 1;
      const share = Math.max(80, Math.round(duration * (Math.max(1, part.length) / totalWeight)));
      const endMs = isLast ? cue.endMs : Math.min(cue.endMs, cursor + share);
      const item = { startMs: cursor, endMs: Math.max(cursor + 80, endMs), text: part };
      cursor = item.endMs;
      return item;
    });
  }

  function mergeCues(cues, settings) {
    const targetMs = Math.max(3000, Number(settings.chunkTargetSec || 8) * 1000);
    const maxMs = Math.max(targetMs, Number(settings.chunkMaxSec || 12) * 1000);
    const maxChars = Math.max(80, Number(settings.chunkMaxChars || 220));
    const maxGap = 1300;
    const out = [];
    let cur = null;
    const normalizedCues = cues.flatMap(cue => splitOversizedCue(cue, maxMs, maxChars));

    for (const cue of normalizedCues) {
      if (!cur) {
        cur = { startMs: cue.startMs, endMs: cue.endMs, text: cue.text };
        continue;
      }
      const gap = cue.startMs - cur.endMs;
      const newDuration = cue.endMs - cur.startMs;
      const joined = `${cur.text} ${cue.text}`.trim();
      const shouldFlush = gap > maxGap || newDuration > maxMs || joined.length > maxChars || (cur.endMs - cur.startMs >= targetMs && /[.!?؟]$/.test(cur.text));
      if (shouldFlush || gap < 0) {
        out.push(cur);
        cur = { startMs: cue.startMs, endMs: cue.endMs, text: cue.text };
      } else {
        cur.endMs = cue.endMs;
        cur.text = joined;
      }
    }
    if (cur) out.push(cur);

    return out
      .filter(x => x.endMs > x.startMs && x.text)
      .map((x, index) => ({ id: index, ...x }));
  }

  function capturedCaptionUrl(meta) {
    const videoId = meta.videoId || getVideoId();
    const urls = (meta.timedTextUrls || []).filter(url => {
      try { return new URL(url).searchParams.get('v') === videoId; } catch { return false; }
    });
    if (!urls.length) return '';
    // Prefer the player's English request when present; otherwise the newest pot-bearing request is reusable per video.
    return urls.find(url => {
      try { return /^en(-|$)/i.test(new URL(url).searchParams.get('lang') || ''); } catch { return false; }
    }) || urls[0];
  }

  function preferredSourceTrack(meta) {
    const tracks = meta?.tracks || [];
    return tracks.find(t => /^en(?:-|$)/i.test(t.languageCode) && t.isTranslatable)
      || tracks.find(t => /^en(?:-|$)/i.test(t.languageCode))
      || tracks.find(t => t.isTranslatable)
      || tracks[0]
      || null;
  }

  function persianTrack(meta) {
    return (meta?.tracks || []).find(t => /^(fa|fa-IR)(?:-|$)/i.test(t.languageCode)) || null;
  }

  async function tryWholeTrack(url, targetLanguage, language, needsTranslation) {
    if (!url) return null;
    const json = await rpc('FETCH_TIMEDTEXT', { url, targetLanguage }, 12000);
    const cues = json3ToCues(json);
    if (cues.length < 2) throw new Error('YouTube timedtext زیرنویس کافی برنگرداند.');
    return { cues, language, needsTranslation };
  }

  async function acquireCaptions(settings) {
    let meta = await rpc('GET_CAPTION_META', {}, 7000);
    if (!meta || (!(meta.tracks || []).length && !(meta.timedTextUrls || []).length)) return null;

    // 1) Prefer a native Persian track when the uploader already supplied one.
    const nativeFa = persianTrack(meta);
    if (nativeFa?.baseUrl) {
      try {
        const result = await tryWholeTrack(nativeFa.baseUrl, null, 'fa', false);
        return { ...result, meta, translationSource: 'youtube-native-fa' };
      } catch (error) {
        console.warn('[Easy-ts] native Persian track failed', error);
      }
    }

    // 2) Ask YouTube for the WHOLE auto-translated Persian track in a single timedtext request.
    // This does not depend on video playback progress.
    const sourceTrack = preferredSourceTrack(meta);
    if (sourceTrack?.baseUrl && sourceTrack.isTranslatable) {
      try {
        const result = await tryWholeTrack(sourceTrack.baseUrl, 'fa', 'fa', false);
        return { ...result, meta, translationSource: 'youtube-auto-translate' };
      } catch (error) {
        console.warn('[Easy-ts] direct YouTube auto-translate failed; priming player token', error);
      }
    }

    // 3) Modern YouTube may require the player's proof-of-origin token (pot). Prime the captions
    // module while preserving pause/currentTime, capture the player's signed timedtext URL, then
    // request the complete Persian auto-translation from that URL.
    let url = capturedCaptionUrl(meta);
    if (!url) {
      try {
        const primed = await rpc('PRIME_CAPTIONS', { targetLanguage: 'fa' }, 5000);
        if (primed?.tracks || primed?.timedTextUrls) meta = primed;
      } catch (error) {
        console.warn('[Easy-ts] caption prime failed', error);
        try {
          await rpc('NUDGE_CAPTIONS', { targetLanguage: 'fa' }, 4000);
          await new Promise(r => setTimeout(r, 900));
          meta = await rpc('GET_CAPTION_META', {}, 4000);
        } catch {}
      }
      url = capturedCaptionUrl(meta);
    }

    if (url) {
      try {
        const result = await tryWholeTrack(url, 'fa', 'fa', false);
        return { ...result, meta, translationSource: 'youtube-auto-translate-signed' };
      } catch (error) {
        console.warn('[Easy-ts] signed Persian timedtext failed', error);
      }
    }

    // 4) If YouTube's auto-translation is unavailable, still fetch the whole source track once
    // and translate only its text with Groq. No audio transcription is needed in this path.
    const sourceUrl = url || sourceTrack?.baseUrl || '';
    if (sourceUrl) {
      try {
        const sourceLang = sourceTrack?.languageCode || 'en';
        const result = await tryWholeTrack(sourceUrl, null, sourceLang, true);
        return { ...result, meta, translationSource: 'groq-text-fallback' };
      } catch (error) {
        console.warn('[Easy-ts] source timedtext failed', error);
      }
    }

    return null;
  }

  function ensurePill() {
    if (statusPill?.isConnected) return statusPill;
    if (![...document.fonts].some(face => face.family === 'EasyTsVazir')) {
      const face = new FontFace('EasyTsVazir', `url("${chrome.runtime.getURL('fonts/Vazir-Medium.woff2')}")`, {weight:'600',display:'swap'});
      document.fonts.add(face); face.load().catch(error => console.warn('[Easy-ts] font loading failed',error));
    }
    const el = document.createElement('div');
    el.id = 'easy-ts-status-pill';
    el.style.cssText = `
      position:fixed;z-index:2147483647;top:76px;right:22px;min-width:220px;max-width:360px;
      padding:12px 14px;border-radius:14px;background:rgba(15,23,42,.94);color:#f8fafc;
      font:600 13px/1.7 EasyTsVazir,Tahoma,"Segoe UI",sans-serif;direction:rtl;
      box-shadow:0 12px 34px rgba(0,0,0,.30);backdrop-filter:blur(16px);border:1px solid rgba(148,163,184,.18);
      transition:opacity .2s ease,transform .2s ease;pointer-events:none;
    `;
    document.documentElement.appendChild(el);
    statusPill = el;
    return el;
  }

  function setPageStatus(text, tone = 'info') {
    if (disposed) return;
    let el;
    try {
      if (!chrome.runtime?.id) throw new Error('Extension context invalidated.');
      el = ensurePill();
    } catch (error) {
      if (/extension context invalidated/i.test(error?.message || '')) { disposeContent(); return; }
      throw error;
    }
    const dotColor = tone === 'error' ? '#ff6b6b' : tone === 'done' ? '#59e39c' : '#5ca8ff';
    el.replaceChildren();
    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:99px;background:${dotColor};margin-left:8px`;
    const label = document.createElement('span');
    label.textContent = String(text || '');
    el.append(dot, label);
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    if (tone === 'done') setTimeout(() => { el.style.opacity = '.22'; el.style.transform = 'translateY(-4px)'; }, 3500);
    sendRuntime({ type: 'EASYTS_CONTENT_STATUS', status: { text: String(text || ''), tone, videoId: currentVideoId }, target: 'background' }).catch(() => {});
  }

  function videoState() {
    const v = currentVideo || getVideo();
    if (!v) return null;
    return {
      videoId: currentVideoId || getVideoId(),
      currentTime: Number(v.currentTime || 0),
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      paused: !!v.paused,
      playbackRate: Number(v.playbackRate || 1),
      volume: Number(v.volume ?? 1),
      muted: applied && sourceMode !== 'groq-live' ? v.dataset.easyTsWasMuted === 'true' : !!v.muted,
      sourceMode,
      applied
    };
  }

  function sendSync() {
    if (disposed) return;
    const state = videoState();
    if (!state?.videoId) return;
    sendRuntime({ type: 'EASYTS_SYNC', state, target: 'background' }).catch(() => {});
  }

  const SYNC_EVENTS = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'loadedmetadata', 'durationchange', 'volumechange', 'timeupdate'];

  function attachSync(video) {
    if (disposed) return;
    if (currentVideo) detachSync();
    currentVideo = video;
    for (const ev of SYNC_EVENTS) video.addEventListener(ev, sendSync, { passive: true });
    clearInterval(syncTimer);
    // timeupdate handles normal playback (~4Hz); this is only a low-frequency safety heartbeat.
    syncTimer = setInterval(sendSync, 1200);
    sendSync();
  }

  function detachSync() {
    if (currentVideo) for (const ev of SYNC_EVENTS) currentVideo.removeEventListener(ev, sendSync);
    clearInterval(syncTimer);
    syncTimer = null;
  }

  async function start() {
    const epoch=navigationEpoch;
    const assertPage=()=>{if(disposed||epoch!==navigationEpoch||getVideoId()!==currentVideoId)throw new Error('ویدئو تغییر کرده است؛ پردازش ویدئوی جدید را شروع کنید.');};
    const video = getVideo();
    if (!video) throw new Error('پلیر ویدیو پیدا نشد.');
    currentVideoId = getVideoId();
    if (!currentVideoId) throw new Error('شناسه ویدیو پیدا نشد.');
    attachSync(video);

    const settings = await getSettings();
    assertPage();
    EasyTsProviders.check(settings,'tts');

    setPageStatus('در حال دریافت کل زیرنویس YouTube و Auto-translate فارسی…');
    if (settings.speakerMode) {EasyTsProviders.check(settings,'stt','capture');EasyTsProviders.check(settings,'translation');}
    const captionResult = settings.speakerMode ? null : await acquireCaptions(settings);
    assertPage();

    if (captionResult?.cues?.length) {
      sourceMode = captionResult.needsTranslation ? 'youtube-captions-groq-translate' : 'youtube-captions';
      const segments = mergeCues(captionResult.cues, settings);
      if (!segments.length) throw new Error('زیرنویس قابل استفاده پیدا نشد.');
      if (captionResult.needsTranslation) EasyTsProviders.check(settings,'translation');
      const job = {
        videoId: currentVideoId,
        title: document.title.replace(/ - YouTube$/, ''),
        voiceId: EasyTsProviders.voice(settings).trim(),
        sourceMode,
        sourceLanguage: captionResult.language || 'en',
        targetLanguage: 'fa',
        needsTranslation: !!captionResult.needsTranslation,
        segments
      };
      setPageStatus(captionResult.needsTranslation
        ? `کل زیرنویس منبع دریافت شد — ترجمه Groq برای ${segments.length} تکه`
        : `کل زیرنویس فارسی YouTube دریافت شد — ${segments.length} تکه برای دوبله`);
      const result = await sendRuntime({ type: 'EASYTS_PREPARE_TTS', job, target: 'background' });
      if (!result?.ok) throw new Error(result?.error || 'شروع ساخت دوبله ناموفق بود.');
      return { mode: sourceMode, segmentCount: segments.length };
    }

    EasyTsProviders.check(settings,'stt','capture');EasyTsProviders.check(settings,'translation');

    sourceMode = 'groq-live';
    setPageStatus(settings.speakerMode ? 'حالت چندگوینده فعال شد؛ ویدیو را برای ضبط پخش کنید.' : 'زیرنویس موجود نیست؛ ضبط صوتی فعال می‌شود.');
    const result = await sendRuntime({
      type: 'EASYTS_START_FALLBACK',
      target: 'background',
      video: { videoId: currentVideoId, title: document.title.replace(/ - YouTube$/, ''), voiceId: EasyTsProviders.voice(settings).trim() },
      initialState: videoState()
    });
    if (!result?.ok) throw new Error(result?.error || 'ضبط صوت شروع نشد.');
    return { mode: sourceMode, segmentCount: 0 };
  }

  async function applyDub() {
    if (!currentVideo) currentVideo = getVideo();
    if (!currentVideo) throw new Error('پلیر ویدیو پیدا نشد.');
    const response = await sendRuntime({ type: 'EASYTS_GET_STATUS' });
    if (!response?.status || response.status.videoId !== currentVideoId || response.status.readySegments < 1) throw new Error('دوبلهٔ این ویدیو هنوز آماده نیست.');
    if (!syncTimer) attachSync(currentVideo);
    applied = true;
    if (sourceMode === 'youtube-captions' || sourceMode === 'youtube-captions-groq-translate') {
      if (currentVideo.dataset.easyTsWasMuted === undefined) {
        currentVideo.dataset.easyTsWasMuted = String(currentVideo.muted);
      }
      currentVideo.muted = true;
    }
    const result = await sendRuntime({ type: 'EASYTS_SET_APPLIED', applied: true, sourceMode, target: 'background' });
    if (!result?.ok) { await stopDub(); throw new Error(result?.error || 'فعال‌کردن دوبله ناموفق بود.'); }
    sendSync();
    setPageStatus('دوبله اعمال شد؛ صدا به timeline ویدیو قفل است.', 'done');
    return { applied: true, sourceMode };
  }

  async function stopDub() {
    applied = false;
    if (currentVideo && (sourceMode === 'youtube-captions' || sourceMode === 'youtube-captions-groq-translate')) {
      const previous = currentVideo.dataset.easyTsWasMuted;
      if (previous !== undefined) currentVideo.muted = previous === 'true';
      delete currentVideo.dataset.easyTsWasMuted;
    }
    await sendRuntime({ type: 'EASYTS_SET_APPLIED', applied: false, sourceMode, target: 'background' }).catch(() => {});
    detachSync();
    setPageStatus('Easy-ts متوقف شد.');
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (disposed || !['EASYTS_PING','EASYTS_START_ON_PAGE','EASYTS_APPLY_ON_PAGE','EASYTS_STOP_ON_PAGE','EASYTS_OFFSCREEN_STATUS'].includes(message?.type)) return false;
    const reply = response => {
      if (disposed) return;
      try { sendResponse(response); }
      catch (error) { if (/extension context invalidated/i.test(error?.message || '')) disposeContent(); }
    };
    (async () => {
      if (message.type === 'EASYTS_PING') {
        let bridge = false;
        try {
          // GET_CAPTION_META also works with the previous MAIN bridge, which makes
          // extension upgrades self-healing even when an old page-world hook survives reload.
          const probe = await rpc('GET_CAPTION_META', {}, 1400);
          bridge = !!probe && typeof probe === 'object';
        } catch {}
        return {
          ok: true,
          bridge,
          videoId: getVideoId(),
          hasVideo: !!getVideo(),
          sourceMode,
          applied
        };
      }
      if (message.type === 'EASYTS_START_ON_PAGE') return await start();
      if (message.type === 'EASYTS_APPLY_ON_PAGE') return await applyDub();
      if (message.type === 'EASYTS_STOP_ON_PAGE') { await stopDub(); return { stopped: true }; }
      if (message.type === 'EASYTS_OFFSCREEN_STATUS') {
        const s = message.status;
        if (s?.videoId && s.videoId === currentVideoId) {
          if (s.phase === 'ready') setPageStatus(`دوبله آماده است — ${s.readySegments}/${s.totalSegments} تکه`, 'done');
          else if (s.phase === 'error') setPageStatus(s.error || 'خطا در پردازش', 'error');
          else if (s.phase) setPageStatus(`${s.label || 'در حال پردازش'} · ${s.progress?.overallPercent == null ? 'ضبط زنده' : s.progress.overallPercent + '%'} · ${s.progress?.remaining ?? 0} تکه باقی‌مانده`);
        }
        return { ok: true };
      }
      return null;
    })().then(reply).catch((error) => reply({ error: error?.message || String(error) }));
    return true;
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  function onNavigate() {
    if (disposed) return;
    if (getVideoId() !== currentVideoId) {
      navigationEpoch++;
      if (currentVideo?.dataset?.easyTsWasMuted !== undefined) {
        currentVideo.muted = currentVideo.dataset.easyTsWasMuted === 'true';
        delete currentVideo.dataset.easyTsWasMuted;
      }
      if(currentVideo||applied||sourceMode)sendRuntime({ type: 'EASYTS_STOP', target: 'background' }).catch(() => {});
      detachSync();
      applied = false;
      sourceMode = null;
      currentVideoId = getVideoId();
      currentVideo = null;
    }
  }
  window.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('yt-page-data-updated', onNavigate);
  window.addEventListener('popstate', onNavigate);
})();
