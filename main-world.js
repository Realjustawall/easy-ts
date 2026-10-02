(() => {
  const BRIDGE_VERSION = '1.8.0';
  const CONTENT_SOURCE = 'easy-ts-content-v1.1.3';
  const MAIN_SOURCE = 'easy-ts-main-v1.1.3';
  if (window.__easyTsMainVersion === BRIDGE_VERSION) return;
  window.__easyTsMainVersion = BRIDGE_VERSION;

  const timedTextUrls = [];
  const MAX_URLS = 30;

  function rememberUrl(url) {
    try {
      const s = String(url || '');
      if (!s.includes('/api/timedtext')) return;
      const u = new URL(s, location.href);
      if (u.hostname !== 'www.youtube.com' && u.hostname !== 'youtube.com') return;
      const value = u.href;
      const idx = timedTextUrls.indexOf(value);
      if (idx >= 0) timedTextUrls.splice(idx, 1);
      timedTextUrls.unshift(value);
      if (timedTextUrls.length > MAX_URLS) timedTextUrls.length = MAX_URLS;
      window.postMessage({ source: MAIN_SOURCE, type: 'TIMEDTEXT_URL', url: value }, '*');
    } catch {}
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    try { rememberUrl(args?.[0]?.url || args?.[0]); } catch {}
    return originalFetch.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { rememberUrl(url); } catch {}
    return originalOpen.call(this, method, url, ...rest);
  };

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) rememberUrl(entry.name);
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch {}

  function readPlayerResponse() {
    const videoId=new URL(location.href).searchParams.get('v')||new URL(location.href).pathname.match(/^\/shorts\/([^/]+)/)?.[1];
    try{
      const active=document.querySelector('ytd-reel-video-renderer[is-active], ytd-reel-video-renderer[active]');
      const response=active?.querySelector('#movie_player')?.getPlayerResponse?.();
      if(response&&(!response.videoDetails?.videoId||response.videoDetails.videoId===videoId))return response;
    }catch{}
    const candidates = [
      window.ytInitialPlayerResponse,
      window.ytplayer?.config?.args?.player_response
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const obj = typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
        if(obj?.videoDetails?.videoId&&obj.videoDetails.videoId!==videoId)continue;
        const tracks = obj?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(tracks) && tracks.length) return obj;
      } catch {}
    }
    try {
      const player = document.getElementById('movie_player');
      const response = player?.getPlayerResponse?.();
      if (response&&(!response.videoDetails?.videoId||response.videoDetails.videoId===videoId)) return response;
    } catch {}
    return null;
  }

  function getTracks() {
    const response = readPlayerResponse();
    const renderer = response?.captions?.playerCaptionsTracklistRenderer;
    return {
      videoId: response?.videoDetails?.videoId || new URL(location.href).searchParams.get('v') || new URL(location.href).pathname.match(/^\/shorts\/([^/]+)/)?.[1] || '',
      tracks: (renderer?.captionTracks || []).map((t, index) => ({
        index,
        baseUrl: t.baseUrl || '',
        languageCode: t.languageCode || '',
        kind: t.kind || '',
        vssId: t.vssId || '',
        isTranslatable: !!t.isTranslatable,
        name: t.name?.simpleText || t.name?.runs?.map(r => r.text).join('') || t.languageCode || ''
      })),
      translationLanguages: (renderer?.translationLanguages || []).map(x => ({
        languageCode: x.languageCode,
        name: x.languageName?.simpleText || x.languageCode
      }))
    };
  }


  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function preferredSourceTrack(meta) {
    const tracks = meta?.tracks || [];
    return tracks.find(t => /^en(?:-|$)/i.test(t.languageCode) && t.isTranslatable)
      || tracks.find(t => /^en(?:-|$)/i.test(t.languageCode))
      || tracks.find(t => t.isTranslatable)
      || tracks[0]
      || null;
  }

  async function primeCaptionRequest(targetLanguage = 'fa') {
    const player = document.querySelector('ytd-reel-video-renderer[is-active] #movie_player, ytd-reel-video-renderer[active] #movie_player') || document.getElementById('movie_player');
    if (!player) return { ...getTracks(), timedTextUrls: [...timedTextUrls], primed: false };

    const video = document.querySelector('ytd-reel-video-renderer[is-active] video, ytd-reel-video-renderer[active] video') || document.querySelector('video.html5-main-video') || document.querySelector('video');
    const button = document.querySelector('.ytp-subtitles-button');
    const wasPressed = button?.getAttribute('aria-pressed') === 'true';
    const wasPaused = !!video?.paused;
    const previousTime = Number(video?.currentTime || 0);
    let previousTrack = null;
    try { previousTrack = player.getOption?.('captions', 'track') || null; } catch {}

    const meta = getTracks();
    const sourceTrack = preferredSourceTrack(meta);
    if (!sourceTrack) return { ...meta, timedTextUrls: [...timedTextUrls], primed: false };

    try {
      try { player.loadModule?.('captions'); } catch {}
      try { player.loadModule?.('subtitles'); } catch {}

      const translation = (meta.translationLanguages || []).find(x => x.languageCode === targetLanguage);
      const trackValue = {
        languageCode: sourceTrack.languageCode,
        ...(sourceTrack.kind ? { kind: sourceTrack.kind } : {})
      };
      if (targetLanguage && sourceTrack.isTranslatable) {
        trackValue.translationLanguage = {
          languageCode: targetLanguage,
          languageName: translation?.name || targetLanguage
        };
      }

      // This asks YouTube's own captions module to request the selected whole track.
      // It does not seek or play the video. On modern YouTube this is useful because
      // the player adds its proof-of-origin token to the timedtext request for us.
      try { player.setOption?.('captions', 'track', trackValue); } catch {}
      try { player.setOption?.('captions', 'reload', true); } catch {}

      if (!wasPressed) {
        try {
          if (typeof player.toggleSubtitlesOn === 'function') player.toggleSubtitlesOn();
          else button?.click();
        } catch {}
      }

      await delay(1300);
      for (const e of performance.getEntriesByType('resource')) rememberUrl(e.name);
    } finally {
      // Preserve the user's playback position/state and previous caption selection.
      try {
        if (previousTrack && Object.keys(previousTrack).length) player.setOption?.('captions', 'track', previousTrack);
      } catch {}
      if (!wasPressed) {
        try {
          const nowPressed = button?.getAttribute('aria-pressed') === 'true';
          if (nowPressed) {
            if (typeof player.toggleSubtitlesOff === 'function') player.toggleSubtitlesOff();
            else button?.click();
          }
        } catch {}
      }
      try {
        if (video && Math.abs(Number(video.currentTime || 0) - previousTime) > 0.12) video.currentTime = previousTime;
        if (video && wasPaused && !video.paused) video.pause();
      } catch {}
    }

    return { ...getTracks(), timedTextUrls: [...timedTextUrls], primed: true };
  }

  async function fetchTimedText(url, targetLanguage = null) {
    const u = new URL(url, location.href);
    u.searchParams.set('fmt', 'json3');
    if (targetLanguage) u.searchParams.set('tlang', targetLanguage);
    else u.searchParams.delete('tlang');
    const res = await originalFetch(u.href, { credentials: 'include' });
    if (!res.ok) throw new Error(`YouTube timedtext HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim()) throw new Error('YouTube timedtext پاسخ خالی برگرداند.');
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error('پاسخ زیرنویس YouTube قابل خواندن نبود.'); }
    return json;
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.source !== CONTENT_SOURCE) return;
    const { requestId, type, payload } = event.data;
    const reply = (ok, data, error) => window.postMessage({
      source: MAIN_SOURCE, type: 'RPC_REPLY', requestId, ok, data, error
    }, '*');

    try {
      if (type === 'PING') {
        return reply(true, { ok: true, videoId: new URL(location.href).searchParams.get('v') || new URL(location.href).pathname.match(/^\/shorts\/([^/]+)/)?.[1] || '' });
      }
      if (type === 'GET_CAPTION_META') {
        for (const e of performance.getEntriesByType('resource')) rememberUrl(e.name);
        return reply(true, { ...getTracks(), timedTextUrls: [...timedTextUrls] });
      }
      if (type === 'FETCH_TIMEDTEXT') {
        const data = await fetchTimedText(payload.url, payload.targetLanguage || null);
        return reply(true, data);
      }
      if (type === 'PRIME_CAPTIONS' || type === 'NUDGE_CAPTIONS') {
        const data = await primeCaptionRequest(payload?.targetLanguage || 'fa');
        return reply(true, data);
      }
      reply(false, null, 'Unknown RPC');
    } catch (error) {
      reply(false, null, error?.message || String(error));
    }
  });
})();
