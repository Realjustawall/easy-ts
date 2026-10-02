import './provider-config.js';
import './settings-schema.js';
import './live-protocol.js';
const OFFSCREEN_URL = 'offscreen.html';

const DEFAULTS = {
  ...EasyTsProviders.defaults,
  deepgramApiKey: '',
  speakerMode: false,
  speakerVoices: [],
  translationStyle: 'natural',
  translationGlossary: '',
  projectNotes: '',
  pronunciationRules: '',
  fishApiKeys: [],
  fishVoiceId: '',
  fishModel: 's2.1-pro-free',
  fishConcurrency: 5,
  fishRetries: 3,
  fishLatency: 'balanced',
  ttsFormat: 'mp3',
  ttsBitrate: 64,
  chunkTargetSec: 8,
  chunkMaxSec: 12,
  chunkMaxChars: 220,
  maxTimeStretch: 1.65,
  groqApiKey: '',
  whisperModel: 'whisper-large-v3-turbo',
  groqTranslationModel: 'openai/gpt-oss-20b',
  fallbackCaptureSec: 15,
  showPersianSubtitles: true,
  autoApplyWhenReady: false
};

let activeDubTabId = null;
const activeTabLoaded = chrome.storage.session.get('activeDubTabId').then(value => { activeDubTabId = value.activeDubTabId ?? null; }).catch(() => {});
async function setActiveTab(id) {
  activeDubTabId = id;
  await chrome.storage.session.set({ activeDubTabId: id });
}

// Settings are dual-written to IndexedDB and chrome.storage.local.
// Some Chromium contexts/builds can expose `chrome` while `chrome.storage` is
// temporarily unavailable; IndexedDB keeps Easy-ts functional in that case.
const SETTINGS_DB_NAME = 'easy-ts-settings-v1';
const SETTINGS_DB_VERSION = 1;
let settingsDbPromise = null;

function openSettingsDb() {
  if (settingsDbPromise) return settingsDbPromise;
  settingsDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(SETTINGS_DB_NAME, SETTINGS_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Settings database failed to open.'));
  });
  return settingsDbPromise;
}

async function readFallbackSettings() {
  try {
    const db = await openSettingsDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get('settings');
      req.onsuccess = () => resolve(req.result && typeof req.result === 'object' ? req.result : {});
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.warn('[Easy-ts] IndexedDB settings read failed:', error);
    return {};
  }
}

async function writeFallbackSettings(settings) {
  try {
    const db = await openSettingsDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(settings, 'settings');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Settings transaction aborted.'));
    });
    return true;
  } catch (error) {
    console.warn('[Easy-ts] IndexedDB settings write failed:', error);
    return false;
  }
}

function chromeStorageArea() {
  return globalThis.chrome?.storage?.local || null;
}

async function readChromeSettings() {
  const area = chromeStorageArea();
  if (!area) return null;
  try {
    return await area.get(null);
  } catch (error) {
    console.warn('[Easy-ts] chrome.storage.local unavailable, using IndexedDB fallback:', error);
    return null;
  }
}

async function writeChromeSettings(values) {
  const area = chromeStorageArea();
  if (!area) return false;
  try {
    await area.set(values);
    return true;
  } catch (error) {
    console.warn('[Easy-ts] chrome.storage.local write failed, IndexedDB copy retained:', error);
    return false;
  }
}

function sanitizeSettingsPatch(values = {}) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(values, key)) out[key] = values[key];
  }
  return out;
}

async function getSettings() {
  const fallback = await readFallbackSettings();
  const primary = await readChromeSettings();
  // Prefer chrome.storage values when available, otherwise retain the fallback copy.
  const merged = { ...DEFAULTS, ...fallback, ...(primary || {}) };

  // Keep the fallback synchronized so a transient storage API failure is harmless.
  await writeFallbackSettings(merged);

  // If chrome.storage came back after a fallback-only session, migrate missing values.
  if (primary) {
    const missing = {};
    for (const [key, value] of Object.entries(merged)) {
      if (primary[key] === undefined) missing[key] = value;
    }
    if (Object.keys(missing).length) await writeChromeSettings(missing);
  }
  return merged;
}

async function setSettings(values = {}) {
  const patch = sanitizeSettingsPatch({...values,...EasyTsSettings.validate(values)});
  const current = await getSettings();
  const merged = { ...current, ...patch };
  await writeFallbackSettings(merged);
  await writeChromeSettings(patch);
  return merged;
}

async function ensureDefaults() {
  await getSettings();
}

chrome.runtime.onInstalled.addListener(() => ensureDefaults().catch(console.error));
chrome.runtime.onStartup.addListener(() => ensureDefaults().catch(console.error));
ensureDefaults().catch(() => {});

function isYoutubeWatch(url = '') {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$/i.test(u.hostname) && ((u.pathname === '/watch' && !!u.searchParams.get('v')) || /^\/shorts\/[^/]+/.test(u.pathname));
  } catch {
    return false;
  }
}

let offscreenCreation = null;
async function ensureOffscreen() {
  if (!offscreenCreation) offscreenCreation = createOffscreenIfMissing().finally(() => { offscreenCreation = null; });
  return offscreenCreation;
}
async function createOffscreenIfMissing() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    if (contexts.length) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK', 'BLOBS'],
      justification: 'Capture tab audio for Whisper fallback, cache generated audio, and play timeline-synced dubbing.'
    });
  } catch (error) {
    if (!String(error?.message || error).includes('Only a single offscreen')) throw error;
  }
}

async function sendToOffscreen(message) {
  await ensureOffscreen();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
      if (!response) throw new Error('Offscreen returned no response.');
      return response;
    } catch (error) {
      // Retry only when no receiver exists yet; never replay a command after it was delivered.
      if (attempt === 3 || !/Receiving end does not exist|Could not establish connection/i.test(error?.message || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      await ensureOffscreen();
    }
  }
}

async function getYoutubeTab(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('تب فعال پیدا نشد.');
  const tab = await chrome.tabs.get(tabId);
  if (!isYoutubeWatch(tab?.url)) throw new Error('یک ویدیوی YouTube را در تب فعال باز کنید.');
  return tab;
}

async function injectPageBridge(tabId) {
  // MAIN bridge must exist even when the tab predates an extension reload/update.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['main-world.js'],
    world: 'MAIN',
    injectImmediately: true
  });
}

async function pingContent(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'EASYTS_PING' });
    return !!response?.ok;
  } catch {
    return false;
  }
}

async function ensureContentReady(tabId) {
  await getYoutubeTab(tabId);

  // Re-injecting main-world.js is safe because it has its own installation guard.
  // This also repairs tabs that were open before the extension was reloaded.
  try { await injectPageBridge(tabId); } catch (error) {
    throw new Error(`امکان اتصال به صفحه YouTube نیست: ${error?.message || error}`);
  }

  if (!(await pingContent(tabId))) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['provider-config.js','engine-core.js','content.js'],
        world: 'ISOLATED',
        injectImmediately: true
      });
    } catch (error) {
      throw new Error(`Content script تزریق نشد: ${error?.message || error}`);
    }
  }

  if (!(await pingContent(tabId))) {
    throw new Error('اتصال Easy-ts به صفحه برقرار نشد. یک‌بار صفحه YouTube را Reload کنید.');
  }
  return true;
}

async function sendPageMessage(tabId, message) {
  await ensureContentReady(tabId);
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    // One recovery pass covers SPA navigation/context invalidation races.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['provider-config.js','engine-core.js','content.js'], world: 'ISOLATED', injectImmediately: true }).catch(() => {});
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (secondError) {
      throw new Error(`ارتباط با صفحه قطع شد: ${secondError?.message || error?.message || secondError}`);
    }
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== activeDubTabId) return;
  setActiveTab(null).catch(() => {});
  sendToOffscreen({ type: 'OFFSCREEN_STOP' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen' || message.target === 'popup') return false;

  (async () => {
    await activeTabLoaded;
    switch (message.type) {
      case 'EASYTS_SETTINGS_GET': {
        return { ok: true, settings: await getSettings(), storage: chromeStorageArea() ? 'chrome+indexeddb' : 'indexeddb' };
      }
      case 'EASYTS_SETTINGS_SET': {
        const settings = await setSettings(message.settings || {});
        return { ok: true, settings, storage: chromeStorageArea() ? 'chrome+indexeddb' : 'indexeddb' };
      }
      case 'EASYTS_PAGE_STATE': {
        const tabId = message.tabId ?? sender.tab?.id;
        const tab = await getYoutubeTab(tabId);
        await ensureContentReady(tabId);
        const page = await chrome.tabs.sendMessage(tabId, { type: 'EASYTS_PING' });
        return { ok: true, tab: { id: tab.id, title: tab.title, url: tab.url }, page };
      }
      case 'EASYTS_START': {
        const tabId = message.tabId ?? sender.tab?.id;
        await getYoutubeTab(tabId);
        if (activeDubTabId !== null) {
          await chrome.tabs.sendMessage(activeDubTabId, { type: 'EASYTS_STOP_ON_PAGE' }).catch(() => {});
        }
        await sendToOffscreen({ type: 'OFFSCREEN_STOP' });
        await setActiveTab(tabId);
        const result = await sendPageMessage(tabId, { type: 'EASYTS_START_ON_PAGE' });
        if (result?.error) throw new Error(result.error);
        await setActiveTab(tabId);
        return { ok: true, ...result };
      }
      case 'EASYTS_STUDIO_OPEN': {
        await chrome.tabs.create({ url: chrome.runtime.getURL('studio.html') });
        return { ok: true };
      }
      case 'EASYTS_SETTINGS_OPEN': {
        await chrome.tabs.create({url:chrome.runtime.getURL('settings.html')});return {ok:true};
      }
      case 'EASYTS_PROVIDER_TEST': {
        if(sender.url!==chrome.runtime.getURL('settings.html'))throw new Error('تست سرویس از صفحهٔ تنظیمات کامل انجام می‌شود.');
        return await sendToOffscreen({type:'OFFSCREEN_PROVIDER_TEST',kind:message.kind,text:message.text});
      }
      case 'EASYTS_LIVE_CONNECT': {
        if(sender.url!==chrome.runtime.getURL('live.html'))throw new Error('اتصال فقط از صفحهٔ ترجمهٔ زنده مجاز است.');
        const settings=await getSettings();
        if(message.provider!==settings.liveProvider||!['openai-live','openai-realtime'].includes(message.provider))throw new Error('تنظیمات سرویس زنده تغییر کرده؛ صفحه را تازه کنید.');
        if(typeof message.sdp!=='string'||message.sdp.length>100000||!message.sdp.startsWith('v=0'))throw new Error('SDP معتبر نیست.');
        if(!settings.openaiApiKey?.trim())throw new Error('OpenAI API Key وارد نشده است.');
        const headers={Authorization:`Bearer ${settings.openaiApiKey.trim()}`,'Content-Type':'application/json'};
        const request=async(url,init)=>{
          const response=await fetch(url,{...init,signal:AbortSignal.timeout(25000)});
          if(!response.ok)throw new Error(`OpenAI HTTP ${response.status}: ${(await response.text()).slice(0,240)}`);return response;
        };
        if(message.provider==='openai-live'){
          const response=await request('https://api.openai.com/v1/live/sessions',{method:'POST',headers,body:JSON.stringify(EasyTsLive.liveSession(settings,message.sdp))});
          const data=await response.json();if(!data.transport?.sdp)throw new Error('GPT-Live پاسخ اتصال برنگرداند.');return {ok:true,sdp:data.transport.sdp};
        }
        const secretResponse=await request('https://api.openai.com/v1/realtime/client_secrets',{method:'POST',headers,body:JSON.stringify({session:EasyTsLive.realtimeSession(settings)})});
        const secret=await secretResponse.json();if(!secret.value)throw new Error('توکن موقت Realtime دریافت نشد.');
        const response=await request('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${secret.value}`,'Content-Type':'application/sdp'},body:message.sdp});return {ok:true,sdp:await response.text()};
      }
      case 'EASYTS_FILE_START': {
        
        if (activeDubTabId != null) await chrome.tabs.sendMessage(activeDubTabId, { type: 'EASYTS_STOP_ON_PAGE' }).catch(() => {});
        await setActiveTab(null);
        return await sendToOffscreen({ type: 'OFFSCREEN_FILE_START', sourceKey: message.sourceKey });
      }
      case 'EASYTS_PROJECT_GET':
        return await sendToOffscreen({ type: 'OFFSCREEN_PROJECT_GET' });
      case 'EASYTS_PROJECT_EDIT':
      case 'EASYTS_PROJECT_MIX':
      case 'EASYTS_PROJECT_VOICE':
      case 'EASYTS_PROJECT_REGENERATE':
      case 'EASYTS_PROJECT_RESTORE':
      case 'EASYTS_RENDER_VIDEO':
      case 'EASYTS_RENDER_AUDIO': {
        if (activeDubTabId != null) await chrome.tabs.sendMessage(activeDubTabId, { type: 'EASYTS_STOP_ON_PAGE' }).catch(() => {});
        await setActiveTab(null);
        const type = message.type.replace('EASYTS_', 'OFFSCREEN_');
        return await sendToOffscreen({ ...message, type });
      }
      case 'EASYTS_PREPARE_TTS': {
        if (sender.tab?.id !== activeDubTabId) throw new Error('این تب پردازش فعال ندارد.');
        const result = await sendToOffscreen({ type: 'OFFSCREEN_PREPARE_TTS', job: message.job });
        if (!result?.ok) throw new Error(result?.error || 'شروع پردازش ناموفق بود.');
        return { ok: true };
      }
      case 'EASYTS_START_FALLBACK': {
        const tabId = message.tabId ?? sender.tab?.id;
        await getYoutubeTab(tabId);
        await setActiveTab(tabId);
        await ensureOffscreen();
        let streamId;
        try {
          streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        } catch (error) {
          throw new Error(`دسترسی صدای تب برقرار نشد: ${error?.message || error}`);
        }
        const result = await sendToOffscreen({
          type: 'OFFSCREEN_START_FALLBACK',
          streamId,
          video: message.video,
          initialState: message.initialState
        });
        if (!result?.ok) throw new Error(result?.error || 'دریافت صدا ناموفق بود.');
        return { ok: true };
      }
      case 'EASYTS_APPLY': {
        const tabId = message.tabId ?? sender.tab?.id;
        if (tabId !== activeDubTabId) throw new Error('دوبله مربوط به تب دیگری است؛ ابتدا برای این تب پردازش را شروع کنید.');
        const result = await sendPageMessage(tabId, { type: 'EASYTS_APPLY_ON_PAGE' });
        if (result?.error) throw new Error(result.error);
        await setActiveTab(tabId);
        return { ok: true, ...result };
      }
      case 'EASYTS_STOP': {
        const tabId = activeDubTabId ?? message.tabId ?? sender.tab?.id;
        if (sender.tab?.id && sender.tab.id !== activeDubTabId) return { ok: true };
        if (Number.isInteger(tabId)) {
          try { await sendPageMessage(tabId, { type: 'EASYTS_STOP_ON_PAGE' }); } catch {}
        }
        await sendToOffscreen({ type: 'OFFSCREEN_STOP' });
        if (tabId === activeDubTabId) await setActiveTab(null);
        return { ok: true };
      }
      case 'EASYTS_SYNC': {
        if (sender.tab?.id !== activeDubTabId) return { ok: false, error: 'تب دیگری در حال دوبله است.' };
        await sendToOffscreen({ type: 'OFFSCREEN_SYNC', state: message.state });
        return { ok: true };
      }
      case 'EASYTS_SET_APPLIED': {
        if (sender.tab?.id !== activeDubTabId) return { ok: false, error: 'تب دیگری در حال دوبله است.' };
        const result = await sendToOffscreen({ type: 'OFFSCREEN_SET_APPLIED', applied: !!message.applied, sourceMode: message.sourceMode });
        if (!result?.ok) throw new Error(result?.error || 'فعال‌کردن دوبله ناموفق بود.');
        return { ok: true };
      }
      case 'EASYTS_EXPORT_SRT': {
        return await sendToOffscreen({ type: 'OFFSCREEN_EXPORT_SRT' });
      }
      case 'EASYTS_GET_STATUS': {
        const offscreen = await sendToOffscreen({ type: 'OFFSCREEN_GET_STATUS' });
        return { ok: true, status: offscreen?.status || null };
      }
      case 'EASYTS_TEST_FISH': {
        const data = await sendToOffscreen({ type: 'OFFSCREEN_TEST_FISH', settings: message.settings || {} });
        if (!data?.ok) throw new Error(data?.error || 'تست Fish Audio ناموفق بود.');
        return { ok: true, voiceId: data.voiceId, bytes: data.bytes };
      }
      case 'EASYTS_CACHE_STATS': {
        const data = await sendToOffscreen({ type: 'OFFSCREEN_CACHE_STATS' });
        return { ok: true, ...data };
      }
      case 'EASYTS_CLEAR_CACHE': {
        const status = await sendToOffscreen({ type: 'OFFSCREEN_GET_STATUS' });
        if (activeDubTabId != null && (!message.videoId || status?.status?.videoId === message.videoId)) {
          await chrome.tabs.sendMessage(activeDubTabId, { type: 'EASYTS_STOP_ON_PAGE' }).catch(() => {});
          await sendToOffscreen({ type: 'OFFSCREEN_STOP' });
        }
        const data = await sendToOffscreen({ type: 'OFFSCREEN_CLEAR_CACHE', videoId: message.videoId || null });
        return { ok: true, ...data };
      }
      case 'EASYTS_OFFSCREEN_STATUS_BROADCAST': {
        if (activeDubTabId != null) await chrome.tabs.sendMessage(activeDubTabId, { type: 'EASYTS_OFFSCREEN_STATUS', status: message.status }).catch(() => {});
        return { ok: true };
      }
      case 'EASYTS_CONTENT_STATUS': {
        chrome.runtime.sendMessage({ ...message, target: 'popup' }).catch(() => {});
        return { ok: true };
      }
      default:
        return { ok: false, error: 'Unknown message' };
    }
  })().then(sendResponse).catch((error) => {
    console.error('[Easy-ts background]', error);
    sendResponse({ ok: false, error: error?.message || String(error) });
  });
  return true;
});
