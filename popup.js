function isSupportedYoutube(url){try{const u=new URL(url);return /(^|\.)youtube\.com$/.test(u.hostname)&&((u.pathname==='/watch'&&!!u.searchParams.get('v'))||/^\/shorts\/[^/]+/.test(u.pathname));}catch{return false;}}
const $ = (id) => document.getElementById(id);
const SETTINGS_IDS = [
  'translationGlossary','projectNotes','pronunciationRules',
  'speakerMode','deepgramApiKey','speakerVoices','translationStyle','ttsBitrate','fishModel','fishApiKeys','fishVoiceId','fishConcurrency','fishRetries','fishLatency','groqApiKey','whisperModel','groqTranslationModel',
  'chunkTargetSec','chunkMaxSec','chunkMaxChars','maxTimeStretch','fallbackCaptureSec'
];

const DEFAULTS = {
  translationGlossary: '', projectNotes: '', pronunciationRules: '',
  speakerMode: false, deepgramApiKey: '', speakerVoices: [], translationStyle: 'natural', ttsBitrate: 64,
  fishModel: 's2.1-pro-free',
  fishApiKeys: [],
  fishVoiceId: '',
  fishConcurrency: 5,
  fishRetries: 3,
  fishLatency: 'balanced',
  groqApiKey: '',
  whisperModel: 'whisper-large-v3-turbo',
  groqTranslationModel: 'openai/gpt-oss-20b',
  chunkTargetSec: 8,
  chunkMaxSec: 12,
  chunkMaxChars: 220,
  maxTimeStretch: 1.65,
  fallbackCaptureSec: 15
};

let activeTab = null;
let latestStatus = null;
let saveTimer = null;
let refreshTimer = null;
let saveChain = Promise.resolve();

async function settingsGet() {
  const res = await chrome.runtime.sendMessage({ type: 'EASYTS_SETTINGS_GET', target: 'background' });
  if (!res?.ok) throw new Error(res?.error || 'خواندن تنظیمات Easy-ts ناموفق بود.');
  return { ...DEFAULTS, ...(res.settings || {}) };
}

async function settingsSet(settings) {
  const res = await chrome.runtime.sendMessage({ type: 'EASYTS_SETTINGS_SET', target: 'background', settings });
  if (!res?.ok) throw new Error(res?.error || 'ذخیره تنظیمات Easy-ts ناموفق بود.');
  return res.settings || settings;
}

function normalizeFishVoiceId(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const id = url.searchParams.get('modelId') || url.searchParams.get('model_id') || url.searchParams.get('reference_id');
    if (id) return id.trim();
  } catch {}
  const query = raw.match(/(?:modelId|model_id|reference_id)=([A-Za-z0-9_-]+)/i);
  if (query) return query[1];
  const hex = raw.match(/\b[0-9a-f]{32}\b/i);
  if (hex) return hex[0];
  return raw.replace(/^['"]|['"]$/g, '').trim();
}


function setTab(name) {
  document.querySelectorAll('.nav-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.nav-tab').forEach(x => { x.setAttribute('role', 'tab'); x.setAttribute('aria-selected', String(x.dataset.tab === name)); x.setAttribute('aria-controls', `tab-${x.dataset.tab}`); });
  document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x.id === `tab-${name}`));
}
document.querySelectorAll('.nav-tab').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

function bytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  const units = ['B','KB','MB','GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function sourceLabel(mode) {
  if (mode === 'file') return 'استودیوی فایل کامل';
  if (mode === 'youtube-captions') return 'YouTube فارسی';
  if (mode === 'youtube-captions-groq-translate') return 'Subtitle + Groq';
  if (mode === 'groq-live') return 'پردازش صوتی';
  return 'آماده';
}

function phaseClass(phase) {
  if (['ready'].includes(phase)) return 'ready';
  if (['error'].includes(phase)) return 'error';
  if (['idle'].includes(phase)) return 'idle';
  return 'busy';
}

function statusUi(status) {
  latestStatus = { ...(latestStatus || {}), ...(status || {}) };
  const s = latestStatus;
  const phase = s.phase || 'idle';
  const total = Number(s.totalSegments || 0);
  const ready = Number(s.readySegments || 0);
  const failed = Number(s.failedSegments || 0);
  const progress = EasyTsCore.progress(s);
  const percent = progress.overallPercent;
  const busy = ['starting', 'transcribing', 'translating', 'generating', 'capturing'].includes(phase);

  const phaseLabels={idle:'آماده برای شروع',starting:'در حال آماده‌سازی پروژه',transcribing:'در حال تشخیص گفتار',translating:'در حال ترجمهٔ جمله‌ها',generating:'در حال ساخت صدای دوبله',capturing:'در حال دریافت گفتار',exporting:'در حال ساخت خروجی',ready:'دوبله آماده است',error:'پردازش به خطا خورد'};
  $('statusText').textContent = s.label || s.text || phaseLabels[phase] || 'در حال پردازش';
  const detail = $('statusDetail');
  const detailText = s.error && s.error !== s.label ? String(s.error) : '';
  if (detail) {
    detail.textContent = detailText;
    detail.hidden = !detailText;
  }
  $('statusBadge').textContent = phase.toUpperCase().slice(0, 12);
  $('statusBadge').className = `status-badge ${phaseClass(phase)}`;
  $('readyCount').textContent = ready;
  $('totalCount').textContent = total;
  $('progressPercent').textContent = percent == null ? '—' : `${percent}%`;
  $('progressBar').style.width = percent == null ? '0%' : `${percent}%`;
  $('overallProgress').classList.toggle('indeterminate', percent == null && busy);
  if (percent == null) $('overallProgress').removeAttribute('aria-valuenow');
  else $('overallProgress').setAttribute('aria-valuenow', percent);
  $('translationPercent').textContent = progress.translationPercent == null ? '—' : `${progress.translationPercent}%`;
  $('audioPercent').textContent = progress.audioPercent == null ? '—' : `${progress.audioPercent}%`;
  $('translationProgress').value = progress.translationPercent || 0;
  $('audioProgress').value = progress.audioPercent || 0;
  $('remainingText').textContent = total ? `${progress.remaining} از ${total} تکه باقی‌مانده` : 'منتظر دریافت گفتار';
  $('failedText').textContent = failed ? `${failed} خطا` : '';
  $('etaText').textContent = s.sourceMode === 'groq-live' ? 'درصدها مربوط به بخش‌های دریافت‌شده‌اند؛ پایان ضبط مشخص نیست.' : s.etaSeconds != null ? `زمان تقریبی باقی‌مانده: ${Math.floor(s.etaSeconds / 60)} دقیقه و ${s.etaSeconds % 60} ثانیه` : phase === 'ready' ? 'همهٔ تکه‌ها آماده‌اند.' : 'زمان باقی‌مانده پس از ساخت اولین تکه تخمین زده می‌شود.';
  $('speakerSummary').textContent = s.speakers ? `${s.speakers} برچسب گوینده در پنجره‌های ضبط` : 'صدای پیش‌فرض · گوینده تشخیص داده نشده';
  $('playbackState').textContent = s.applied ? 'دوبله فعال' : 'دوبله غیرفعال';
  $('playbackState').classList.toggle('on', !!s.applied);
  $('exportSrtBtn').disabled = !(Number(s.translatedSegments) > 0);
  $('startBtn').disabled = busy || !isSupportedYoutube(activeTab?.url);

  $('sourceChip').textContent = sourceLabel(s.sourceMode);

  const isLive = s.sourceMode === 'groq-live';
  $('applyBtn').disabled = ready < 1 || !!s.applied || s.sourceMode === 'file';
  $('applyBtn').querySelector('span:last-child').textContent = s.applied ? 'دوبله فعال است' : ready < total ? 'پخش بخش‌های آماده' : 'پخش دوبله';
  $('startBtnLabel').textContent = failed > 0 ? 'تلاش مجدد برای تکه‌های خطادار' : (phase === 'ready' ? 'ساخت دوباره / بررسی کش' : 'شروع پردازش');
}

function setConnection(state, text) {
  const el = $('pageConnection');
  el.className = `connection-chip ${state}`;
  $('pageConnectionText').textContent = text;
}

function setSaveState(state, text) {
  const el = $('saveState');
  el.className = `save-state ${state}`;
  el.querySelector('span').textContent = text;
}

async function getActiveTab() {
  let tab;
  if (document.body.dataset.page === 'dashboard') {
    const tabs = (await chrome.tabs.query({ url: ['*://*.youtube.com/watch*','*://youtube.com/watch*','*://*.youtube.com/shorts/*','*://youtube.com/shorts/*'] }))
      .filter(t => isSupportedYoutube(t.url))
      .sort((a,b) => Number(b.active)-Number(a.active) || (b.lastAccessed||0)-(a.lastAccessed||0));
    tab = tabs.find(t => String(t.id) === document.body.dataset.selectedTab) || tabs[0];
    const picker = $('dashboardVideoTab');
    picker.replaceChildren();
    for (const candidate of tabs) picker.append(new Option(candidate.title?.replace(/ - YouTube$/, '') || 'YouTube', String(candidate.id)));
    if (tab) picker.value = String(tab.id);
    else picker.append(new Option('ویدیوی YouTube باز نیست', ''));
    picker.disabled = !tabs.length;
  } else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  const isWatch = !!tab?.url && isSupportedYoutube(tab.url);
  if (isWatch) {
    $('videoTitle').textContent = tab.title?.replace(/ - YouTube$/, '') || 'ویدیوی YouTube';
    try {
      const u = new URL(tab.url);
      $('videoMeta').textContent = `YouTube ${u.pathname.startsWith('/shorts/')?'Shorts':'Watch'} · ${u.searchParams.get('v') || u.pathname.split('/shorts/')[1] || ''}`;
    } catch {
      $('videoMeta').textContent = 'youtube.com/watch';
    }
  } else {
    $('videoTitle').textContent = 'یک ویدیوی YouTube باز کنید';
    $('videoMeta').textContent = 'یک ویدیوی YouTube یا Shorts باز کنید';
  }
  return tab;
}

async function refreshPageConnection() {
  const tab = await getActiveTab();
  if (!tab?.id || !isSupportedYoutube(tab?.url)) {
    setConnection('error', 'صفحه نامعتبر');
    $('startBtn').disabled = true;
    return false;
  }

  setConnection('checking', 'در حال اتصال');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'EASYTS_PAGE_STATE', tabId: tab.id });
    if (!res?.ok) throw new Error(res?.error || 'اتصال برقرار نشد');
    const page = res.page || {};
    if (!page.bridge) throw new Error('Bridge صفحه آماده نیست');
    if (!page.hasVideo) throw new Error('پلیر ویدیو هنوز آماده نیست');
    setConnection('connected', 'صفحه متصل');
    if (latestStatus) statusUi(latestStatus);
    else $('startBtn').disabled = false;
    return true;
  } catch (error) {
    setConnection('error', 'اتصال ناموفق');
    $('startBtn').disabled = false; // START itself performs one more recovery attempt.
    statusUi({ phase: 'error', label: error?.message || String(error) });
    return false;
  }
}

async function loadSettings() {
  const stored = await settingsGet();
  $('fishApiKeys').value = (stored.fishApiKeys || []).join('\n');
  for (const id of SETTINGS_IDS) {
    if (id === 'fishApiKeys') continue;
    const el = $(id);
    if (el && stored[id] !== undefined) {
      if (id === 'speakerMode') el.checked = !!stored[id];
      else if (id === 'speakerVoices') el.value = stored[id].join('\n');
      else el.value = stored[id];
    }
  }
}

function collectSettings() {
  const data = {
    translationGlossary: $('translationGlossary').value.slice(0, 6000),
    projectNotes: $('projectNotes').value.slice(0, 4000),
    pronunciationRules: $('pronunciationRules').value.slice(0, 6000),
    speakerMode: $('speakerMode').checked,
    deepgramApiKey: $('deepgramApiKey').value.trim(),
    speakerVoices: $('speakerVoices').value.split(/\r?\n/).map(normalizeFishVoiceId),
    translationStyle: $('translationStyle').value,
    ttsBitrate: Number($('ttsBitrate').value),
    fishModel: $('fishModel').value,
    fishApiKeys: $('fishApiKeys').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean),
    fishVoiceId: normalizeFishVoiceId($('fishVoiceId').value),
    fishConcurrency: Math.min(10, Math.max(1, Number($('fishConcurrency').value || 5))),
    fishRetries: Math.min(8, Math.max(0, Number($('fishRetries').value || 3))),
    fishLatency: $('fishLatency').value,
    groqApiKey: $('groqApiKey').value.trim(),
    whisperModel: $('whisperModel').value,
    groqTranslationModel: $('groqTranslationModel').value,
    chunkTargetSec: Math.min(20, Math.max(3, Number($('chunkTargetSec').value || 8))),
    chunkMaxSec: Math.min(30, Math.max(5, Number($('chunkMaxSec').value || 12))),
    chunkMaxChars: Math.min(600, Math.max(80, Number($('chunkMaxChars').value || 220))),
    maxTimeStretch: Math.min(3, Math.max(1, Number($('maxTimeStretch').value || 1.65))),
    fallbackCaptureSec: Math.min(30, Math.max(8, Number($('fallbackCaptureSec').value || 15)))
  };
  if (data.chunkMaxSec < data.chunkTargetSec) data.chunkMaxSec = data.chunkTargetSec;
  return data;
}

async function saveSettings({ quiet = false } = {}) {
  const data = collectSettings();
  if (!quiet) setSaveState('saving', 'در حال ذخیره');
  const operation = async () => {
    await settingsSet(data);
    // Reflect normalized values back to the UI.
    if (document.activeElement !== $('fishVoiceId')) $('fishVoiceId').value = data.fishVoiceId;
    for (const id of ['fishConcurrency','fishRetries','chunkTargetSec','chunkMaxSec','chunkMaxChars','maxTimeStretch','fallbackCaptureSec']) {
      if (data[id] !== undefined && document.activeElement !== $(id)) $(id).value = data[id];
    }
    setSaveState('saved', 'ذخیره شده');
  };
  saveChain = saveChain.catch(() => {}).then(operation);
  try {
    await saveChain;
  } catch (error) {
    setSaveState('error', 'خطای ذخیره');
    throw error;
  }
}

function queueAutoSave() {
  clearTimeout(saveTimer);
  setSaveState('saving', 'در حال ذخیره');
  saveTimer = setTimeout(() => saveSettings().catch(() => {}), 280);
}

for (const id of SETTINGS_IDS) {
  const el = $(id);
  if (!el) continue;
  el.addEventListener('input', queueAutoSave);
  el.addEventListener('change', () => {
    clearTimeout(saveTimer);
    saveSettings().catch(() => {});
  });
  el.addEventListener('blur', () => {
    clearTimeout(saveTimer);
    saveSettings({ quiet: true }).catch(() => {});
  });
}


$('fishVoiceId').addEventListener('blur', () => {
  const normalized = normalizeFishVoiceId($('fishVoiceId').value);
  if (normalized && normalized !== $('fishVoiceId').value.trim()) $('fishVoiceId').value = normalized;
});

$('testFishBtn').addEventListener('click', () => act($('testFishBtn'), async () => {
  clearTimeout(saveTimer);
  const settings = collectSettings();
  if (!settings.fishApiKeys.length) throw new Error('ابتدا Fish API Key را وارد کنید.');
  if (!settings.fishVoiceId) throw new Error('ابتدا Voice ID یا لینک صدای Fish را وارد کنید.');
  $('fishVoiceId').value = settings.fishVoiceId;
  $('fishTestState').textContent = 'در حال تست مستقیم Voice با Fish Audio…';
  $('fishTestState').className = 'field-help testing';
  await settingsSet(settings);
  const res = await chrome.runtime.sendMessage({ type: 'EASYTS_TEST_FISH', settings });
  if (!res?.ok) throw new Error(res?.error || 'تست Voice ناموفق بود.');
  $('fishTestState').textContent = `✓ Voice معتبر است · ${res.voiceId}`;
  $('fishTestState').className = 'field-help success';
  statusUi({ phase: 'idle', label: 'Fish Voice با موفقیت تست شد.', error: null });
}));

document.querySelectorAll('.reveal-btn').forEach(btn => btn.addEventListener('click', () => {
  const input = $(btn.dataset.target);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'مخفی' : 'نمایش';
}));

async function refreshStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'EASYTS_GET_STATUS' });
    if (res?.status) statusUi(res.status);
  } catch {}
  try {
    const c = await chrome.runtime.sendMessage({ type: 'EASYTS_CACHE_STATS' });
    if (c?.ok) {
      $('cacheMetric').textContent = bytes(c.bytes);
      $('cacheStats').textContent = `${c.jobs} پردازش · ${c.audioFiles || 0} فایل · ${bytes(c.bytes)}`;
    }
  } catch {}
}

async function act(button, task) {
  const oldDisabled = button.disabled;
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    const message = error?.message || String(error);
    statusUi({ phase: 'error', label: button === $('testFishBtn') ? 'تست Fish Audio ناموفق بود' : message, error: button === $('testFishBtn') ? message : null });
    if (button === $('testFishBtn')) {
      $('fishTestState').textContent = `✕ ${message}`;
      $('fishTestState').className = 'field-help error';
      setTab('settings');
    }
  } finally {
    if (button === $('applyBtn')) {
      const s = latestStatus || {};
      const total = Number(s.totalSegments || 0), ready = Number(s.readySegments || 0), failed = Number(s.failedSegments || 0);
      button.disabled = ready < 1 || !!s.applied || s.sourceMode === 'file';
    } else {
      if (button === $('startBtn')) statusUi(latestStatus);
      else button.disabled = false;
    }
  }
}

$('reconnectBtn').addEventListener('click', () => act($('reconnectBtn'), async () => {
  await refreshPageConnection();
}));

$('openStudioBtn').addEventListener('click', () => act($('openStudioBtn'), async () => {
  clearTimeout(saveTimer);
  await saveSettings({ quiet: true });
  const result = await chrome.runtime.sendMessage({ type: 'EASYTS_STUDIO_OPEN' });
  if (!result?.ok) throw new Error(result?.error || 'استودیو باز نشد.');
}));

$('startBtn').addEventListener('click', () => act($('startBtn'), async () => {
  clearTimeout(saveTimer);
  await saveSettings({ quiet: true });
  const tab = await getActiveTab();
  if (!tab?.id || !isSupportedYoutube(tab.url)) throw new Error('ابتدا یک ویدیوی YouTube را باز کنید.');
  setConnection('checking', 'در حال اتصال');
  statusUi({ phase: 'starting', label: 'در حال اتصال به YouTube و بررسی زیرنویس…', readySegments: 0, translatedSegments: 0, totalSegments: 0, failedSegments: 0, applied: false, error: null, etaSeconds: null });
  const res = await chrome.runtime.sendMessage({ type: 'EASYTS_START', tabId: tab.id });
  if (!res?.ok) throw new Error(res?.error || 'شروع پردازش ناموفق بود.');
  setConnection('connected', 'صفحه متصل');
  statusUi({
    sourceMode: res.mode,
    label: res.mode === 'youtube-captions'
      ? 'زیرنویس فارسی YouTube دریافت شد؛ ساخت صدا شروع شد.'
      : res.mode === 'youtube-captions-groq-translate'
        ? 'زیرنویس انگلیسی دریافت شد؛ ترجمه و ساخت صدا شروع شد.'
        : 'Fallback صوتی Groq شروع شد.'
  });
  setTimeout(refreshStatus, 250);
}));

$('applyBtn').addEventListener('click', () => act($('applyBtn'), async () => {
  const tab = activeTab || await getActiveTab();
  if (!tab?.id) throw new Error('تب YouTube پیدا نشد.');
  const res = await chrome.runtime.sendMessage({ type: 'EASYTS_APPLY', tabId: tab.id });
  if (!res?.ok) throw new Error(res?.error || 'اعمال دوبله ناموفق بود.');
  statusUi({ applied: true, label: 'دوبله فعال شد؛ پخش با زمان ویدیو هماهنگ است.' });
}));

$('stopBtn').addEventListener('click', () => act($('stopBtn'), async () => {
  const tab = activeTab || await getActiveTab();
  const res = await chrome.runtime.sendMessage({ type: 'EASYTS_STOP', tabId: tab?.id });
  if (!res?.ok) throw new Error(res?.error || 'توقف ناموفق بود.');
  statusUi({ phase: 'idle', label: 'متوقف شد؛ صدای اصلی برگشت.', applied: false });
}));

$('clearAllCacheBtn').addEventListener('click', async () => {
  if (!confirm('کل کش Easy-ts حذف شود؟')) return;
  const res = await chrome.runtime.sendMessage({ type: 'EASYTS_CLEAR_CACHE' });
  if (!res?.ok) statusUi({ phase: 'error', label: res?.error || 'حذف کش ناموفق بود.' });
  await refreshStatus();
});

$('clearVideoCacheBtn').addEventListener('click', async () => {
  const tab = activeTab || await getActiveTab();
  let videoId = '';
  try { videoId = new URL(tab?.url || '').searchParams.get('v') || new URL(tab?.url || '').pathname.match(/^\/shorts\/([^/]+)/)?.[1] || ''; } catch {}
  if (!videoId) return;
  const res = await chrome.runtime.sendMessage({ type: 'EASYTS_CLEAR_CACHE', videoId });
  if (!res?.ok) statusUi({ phase: 'error', label: res?.error || 'حذف کش ویدیو ناموفق بود.' });
  await refreshStatus();
});

$('exportSrtBtn').addEventListener('click', () => act($('exportSrtBtn'), async () => {
  const result = await chrome.runtime.sendMessage({ type: 'EASYTS_EXPORT_SRT' });
  if (!result?.ok) throw new Error(result?.error || 'خروجی ناموفق بود.');
  const url = URL.createObjectURL(new Blob(['\uFEFF', result.srt], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `Easy-ts-${result.videoId}-fa.srt`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}));

chrome.runtime.onMessage.addListener((message) => {
  if (message.target === 'popup' && message.status && !latestStatus?.phase) statusUi(message.status);
  if (message.type === 'EASYTS_OFFSCREEN_STATUS_BROADCAST') statusUi(message.status);
});

(async () => {
  try {
    await loadSettings();
    await getActiveTab();
    await Promise.allSettled([refreshPageConnection(), refreshStatus()]);
    refreshTimer = setInterval(refreshStatus, 1400);
  } catch (error) {
    console.error('[Easy-ts popup startup]', error);
    statusUi({ phase: 'error', label: 'راه‌اندازی Easy-ts ناموفق بود', error: error?.message || String(error) });
    setSaveState('error', 'خطای تنظیمات');
  }
})();

window.addEventListener('unload', () => {
  clearInterval(refreshTimer);
  clearTimeout(saveTimer);
});
