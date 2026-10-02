async (page) => {
  await page.reload();
  await page.evaluate(() => clearInterval(refreshTimer));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.evaluate(() => statusUi({phase:'generating',videoId:'demo',totalSegments:10,translatedSegments:10,readySegments:4,failedSegments:1,etaSeconds:75,sourceMode:'youtube-captions-groq-translate',error:'نمونهٔ خطای قابل تکرار'}));
  assert(await page.locator('#progressPercent').textContent() === '70%', 'overall progress');
  assert(await page.locator('#translationPercent').textContent() === '100%', 'translation progress');
  assert(await page.locator('#audioPercent').textContent() === '40%', 'audio progress');
  assert(await page.locator('#remainingText').textContent() === '6 از 10 تکه باقی‌مانده', 'remaining count');
  assert(await page.locator('#applyBtn').isEnabled(), 'partial playback');
  assert(await page.locator('#startBtn').isDisabled(), 'duplicate start prevented');
  assert(await page.locator('#statusDetail').isVisible(), 'error details');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  await page.screenshot({path:'output/playwright/popup-progress.png',fullPage:true});
  await page.evaluate(() => statusUi({phase:'capturing',sourceMode:'groq-live',error:null}));
  assert(await page.locator('#progressPercent').textContent() === '—', 'live total remains unknown');
  await page.getByRole('button',{name:'تنظیمات',exact:true}).click();
  await page.locator('#speakerMode').check();
  await page.locator('#deepgramApiKey').fill('preview-only');
  await page.locator('#speakerVoices').fill('voice-one\n\nvoice-three');
  await page.locator('#ttsBitrate').selectOption('192');
  const collected = await page.evaluate(() => collectSettings());
  assert(collected.speakerMode && collected.ttsBitrate === 192, 'settings collect');
  assert(collected.speakerVoices[1] === '', 'blank voice slot preserved');
  await page.locator('#deepgramApiKey').blur();
  await page.locator('#saveState.saved').waitFor();
  await page.screenshot({path:'output/playwright/popup-settings.png'});
  console.log('UI checks passed: stage progress, remaining count, ETA, partial playback, duplicate start, errors, live state, speaker settings, autosave and layout.');
}
