/* Offline speech rendering: granular overlap/add preserves local pitch instead of resampling speech. */
(function (root) {
  function stretch(input, rate, sampleRate) {
    if (!(rate >= 1 && rate <= 4)) throw new Error('Unsupported stretch rate');
    if (rate === 1) return input;
    const length = Math.max(1, Math.round(input.length / rate));
    const window = Math.max(32, Math.round(sampleRate * .04));
    const hop = Math.max(8, Math.round(sampleRate * .01));
    const search = Math.round(sampleRate * .008);
    const out = new Float32Array(length + window);
    const weights = new Float32Array(length + window);
    const hann = Float32Array.from({ length: window }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (window - 1)));
    let previous = 0;
    for (let position = 0; position < length; position += hop) {
      const predicted = Math.round(position * rate);
      let best = Math.min(predicted, Math.max(0, input.length - window));
      if (position > 0) {
        let score = -Infinity;
        const low = Math.max(previous + 1, predicted - search);
        const high = Math.min(input.length - window, predicted + search);
        for (let candidate = low; candidate <= high; candidate += 8) {
          let dot = 0, energy = 0, referenceEnergy = 0;
          for (let j = 0; j < window - hop; j += 8) {
            const reference = weights[position + j] > 0 ? out[position + j] / weights[position + j] : 0;
            const sample = input[candidate + j];
            dot += sample * reference; energy += sample * sample; referenceEnergy += reference * reference;
          }
          const correlation = dot / Math.sqrt(energy * referenceEnergy + 1e-12);
          if (correlation > score) { score = correlation; best = candidate; }
        }
      }
      previous = best;
      for (let j = 0; j < window && best + j < input.length; j++) {
        out[position + j] += input[best + j] * hann[j]; weights[position + j] += hann[j];
      }
    }
    const result = out.subarray(0, length);
    for (let i = 0; i < length; i++) if (weights[i] > 1e-6) result[i] /= weights[i];
    return result;
  }
  function mix(target, samples, start) {
    start = Math.round(start);
    for (let i = Math.max(0, -start); i < samples.length && start + i < target.length; i++) target[start + i] += samples[i];
  }
  function background(target, samples, rate, segments, gain = .35, duck = .3) {
    if (!Number.isFinite(gain) || gain < 0 || gain > 2 || !Number.isFinite(duck) || duck < 0 || duck > 1) throw new Error('Invalid background levels');
    // Merge overlapping dialogue ranges before applying an attack/release envelope.
    const ranges = [];
    for (const s of [...segments].sort((a,b) => a.startMs-b.startMs)) {
      const start = Math.max(0, Math.round(s.startMs / 1000 * rate)), end = Math.round(s.endMs / 1000 * rate);
      if (end <= start) continue;
      const last = ranges[ranges.length-1];
      if (last && start <= last[1]) last[1] = Math.max(last[1],end); else ranges.push([start,end]);
    }
    let range = 0, envelope = 1;
    const attack = Math.exp(-1/(rate*.025)), release = Math.exp(-1/(rate*.25));
    for (let i=0;i<target.length && i<samples.length;i++) {
      while (range<ranges.length && i>=ranges[range][1]) range++;
      const speaking = range<ranges.length && i>=ranges[range][0];
      const desired = speaking ? duck : 1, smoothing = desired<envelope ? attack : release;
      envelope = desired+(envelope-desired)*smoothing;
      target[i] += samples[i]*gain*envelope;
    }
  }
  function wav(samples, rate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
    const ascii = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
    let peak = 1;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    const gain = .96 / peak;
    for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(samples[i] * gain * 32767), true);
    return new Blob([buffer], { type: 'audio/wav' });
  }
  async function webmDuration(blob, seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid video duration');
    // Only read the small EBML header; Blob slices avoid copying a large video into RAM.
    const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
    function element(offset) {
      const start = offset;
      if (offset >= bytes.length) throw new Error('Truncated WebM header');
      let idLength = 1; while (idLength <= 4 && !(bytes[offset] & (1 << (8 - idLength)))) idLength++;
      if (idLength > 4) throw new Error('Invalid EBML ID');
      let id = 0; for (let i = 0; i < idLength; i++) id = id * 256 + bytes[offset++];
      const sizeOffset = offset; let sizeLength = 1; while (sizeLength <= 8 && !(bytes[offset] & (1 << (8 - sizeLength)))) sizeLength++;
      if (sizeLength > 8 || offset + sizeLength > bytes.length) throw new Error('Invalid EBML size');
      let size = bytes[offset] & ((1 << (8 - sizeLength)) - 1), unknown = size === ((1 << (8 - sizeLength)) - 1);
      offset++;
      for (let i = 1; i < sizeLength; i++) { unknown = unknown && bytes[offset] === 255; size = size * 256 + bytes[offset++]; }
      return { start, id, sizeOffset, sizeLength, body: offset, size: unknown ? Infinity : size, end: unknown ? Infinity : offset + size };
    }
    function encodeSize(size, length) {
      while (size > 2 ** (7 * length) - 2) length++;
      const out = new Uint8Array(length);
      for (let i = length - 1; i >= 0; i--) { out[i] = size % 256; size = Math.floor(size / 256); }
      out[0] |= 1 << (8 - length); return out;
    }
    let offset = 0, segment;
    while (offset < bytes.length) { const item = element(offset); if (item.id === 0x18538067) { segment = item; break; } offset = item.end; }
    if (!segment) throw new Error('WebM segment missing');
    let info; offset = segment.body;
    while (offset < bytes.length) { const item = element(offset); if (item.id === 0x1549a966) { info = item; break; } if (item.id === 0x114d9b74) throw new Error('Unexpected indexed WebM from recorder'); offset = item.end; }
    if (!info || info.end > bytes.length) throw new Error('WebM timing header missing');
    let scale = 1000000, duration; offset = info.body;
    while (offset < info.end) {
      const item = element(offset);
      if (item.id === 0x2ad7b1) { scale = 0; for (let i = item.body; i < item.end; i++) scale = scale * 256 + bytes[i]; }
      if (item.id === 0x4489) duration = item;
      offset = item.end;
    }
    const value = seconds * 1e9 / scale;
    if (duration) {
      const encoded = new Uint8Array(duration.size), view = new DataView(encoded.buffer);
      if (duration.size === 8) view.setFloat64(0, value); else if (duration.size === 4) view.setFloat32(0, value); else throw new Error('Invalid duration field');
      return new Blob([blob.slice(0, duration.body), encoded, blob.slice(duration.end)], { type: blob.type });
    }
    const field = new Uint8Array(11); field.set([0x44, 0x89, 0x88]); new DataView(field.buffer).setFloat64(3, value);
    const infoSize = encodeSize(info.size + field.length, info.sizeLength);
    const delta = field.length + infoSize.length - info.sizeLength;
    const prefix = Number.isFinite(segment.size) ? [blob.slice(0, segment.sizeOffset), encodeSize(segment.size + delta, segment.sizeLength), blob.slice(segment.body, info.sizeOffset)] : [blob.slice(0, info.sizeOffset)];
    return new Blob([...prefix, infoSize, blob.slice(info.body, info.end), field, blob.slice(info.end)], { type: blob.type });
  }
  root.EasyTsAudio = { stretch, mix, background, wav, webmDuration };
  if (typeof module !== 'undefined') module.exports = root.EasyTsAudio;
})(globalThis);
