/* Pure timeline/progress helpers, shared with the regression tests. */
(function (root) {
  const bounded = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));
  function progress(status) {
    const total = Math.max(0, Number(status.totalSegments) || 0);
    const ready = bounded(status.readySegments, 0, total);
    const translated = bounded(status.translatedSegments, 0, total);
    const failed = bounded(status.failedSegments, 0, total - ready);
    const live = status.sourceMode === 'groq-live';
    return { total, ready, failed, remaining: total - ready,
      translationPercent: total ? Math.round(translated / total * 100) : null,
      audioPercent: total ? Math.round(ready / total * 100) : null,
      overallPercent: live ? null : total ? Math.round((translated + ready) / (2 * total) * 100) : null };
  }
  function activeSegments(segments, timeMs) {
    return segments.filter(s => s.ready && s.startMs <= timeMs && s.endMs > timeMs);
  }
  function sequentialTimeline(segments, maxStretch = 1.65) {
    let cursor = 0;
    return segments.map((s, index) => ({ ...s, order: index }))
      .sort((a, b) => a.startMs - b.startMs || a.order - b.order)
      .map(s => {
        const slot = Math.max(80, s.endMs - s.startMs);
        const duration = Math.max(slot, (Number(s.audioDuration) || 0) * 1000 / bounded(maxStretch, 1, 3));
        const startMs = Math.max(cursor, s.startMs);
        cursor = startMs + duration;
        return { ...s, sourceStartMs: s.startMs, sourceEndMs: s.endMs, startMs, endMs: cursor };
      });
  }
  function normalizeCaptions(cues) {
    const out = [];
    const key = word => word.toLowerCase().replace(/[.,!?؟،؛:]/g, '');
    for (const input of [...cues].sort((a, b) => a.startMs - b.startMs)) {
      const cue = { ...input, text: String(input.text || '').replace(/\s+/g, ' ').trim() };
      if (!cue.text || !Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.endMs <= cue.startMs) continue;
      const previous = out.at(-1);
      if (previous && cue.startMs < previous.endMs) {
        const a = previous.text.split(' '), b = cue.text.split(' ');
        let overlap = Math.min(a.length, b.length);
        while (overlap && !a.slice(-overlap).every((word, i) => key(word) === key(b[i]))) overlap--;
        if (overlap === b.length) { previous.endMs = Math.max(previous.endMs, cue.endMs); continue; }
        if (overlap >= 2) cue.text = b.slice(overlap).join(' ');
        // Rolling captions reuse display windows. End the previous phrase at the next phrase.
        if (cue.startMs > previous.startMs) previous.endMs = cue.startMs;
        else { previous.text += ' ' + cue.text; previous.endMs = Math.max(previous.endMs, cue.endMs); continue; }
      }
      out.push(cue);
    }
    return out;
  }
  function normalizeUtterances(utterances, win, maxSec = 12, maxChars = 220) {
    const out = [];
    for (const u of utterances || []) {
      // Word timestamps let long turns split without invented timing or lost overlap.
      const words = u.words?.length ? u.words : [{ start: u.start, end: u.end, punctuated_word: u.transcript, speaker: u.speaker }];
      let group = null;
      for (const w of words) {
        const startMs = Math.round((win.startVideoSec + Number(w.start) * win.playbackRate) * 1000);
        const endMs = Math.round((win.startVideoSec + Number(w.end) * win.playbackRate) * 1000);
        const text = String(w.punctuated_word || w.word || '').trim();
        const speaker = w.speaker ?? u.speaker ?? null;
        if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
        if (!group || speaker !== group.speaker || startMs < group.endMs || startMs - group.endMs > 1300 || endMs - group.startMs > maxSec * 1000 || group.text.length + text.length + 1 > maxChars) {
          if (group) out.push(group);
          group = { startMs, endMs, text, speaker, speakerScope: win.scope, confidence: Number.isFinite(w.confidence) ? w.confidence : null };
        } else { group.endMs = endMs; group.text += ' ' + text; if (Number.isFinite(w.confidence)) group.confidence = group.confidence == null ? w.confidence : Math.min(group.confidence, w.confidence); }
      }
      if (group) out.push(group);
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }
  function srt(segments) {
    const timestamp = ms => {
      ms = Math.max(0, Math.round(ms));
      return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
    };
    return segments.map((s, i) => `${i + 1}\n${timestamp(s.startMs)} --> ${timestamp(s.endMs)}\n${s.speaker == null ? '' : `[گوینده ${Number(s.speaker) + 1}${s.speakerScope === 'file' ? '' : ` · بخش ${s.speakerScope}`}] `}${String(s.text).replace(/\r?\n/g, ' ')}\n`).join('\n');
  }
  function pronounce(text, rules = '') {
    for (const line of String(rules || '').split(/\r?\n/).slice(0, 100)) {
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const from = line.slice(0, separator).trim(), to = line.slice(separator + 1).trim();
      if (from && to) text = text.split(from).join(to);
    }
    return text;
  }
  function context(segments, budget = 18000) {
    const lines = segments.map(s => `${s.speaker ?? '?'}: ${s.sourceText || s.text}`);
    const full = lines.join('\n');
    if (full.length <= budget) return full;
    const quota = Math.max(1, Math.floor(budget / 220));
    return Array.from({ length: quota }, (_, i) => lines[Math.floor(i * (lines.length - 1) / Math.max(1, quota - 1))].slice(0, 210)).join('\n').slice(0, budget);
  }
  root.EasyTsCore = { progress, activeSegments, sequentialTimeline, normalizeCaptions, normalizeUtterances, srt, pronounce, context };
  if (typeof module !== 'undefined') module.exports = root.EasyTsCore;
})(globalThis);
