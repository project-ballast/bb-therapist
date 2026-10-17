// Voice input: speech-to-text plus simple on-phone voice measurements.
// Raw audio never leaves this file; only the transcript and a few numbers do.
// Note: the browser's speech-to-text may send audio to Apple or Google to transcribe it.

const FRAME_MS = 50;
const MIN_HZ = 75;
const MAX_HZ = 400;

const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const speechSupported = () => !!Recognition && !!navigator.mediaDevices?.getUserMedia;

export class VoiceSession {
  constructor({ onTranscript } = {}) {
    this.onTranscript = onTranscript || (() => {});
    this.frames = []; // {rms, pitch}
    this.finalText = "";
    this.interim = "";
    this.active = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.active = true;
    this.timer = setInterval(() => this.sample(), FRAME_MS);
    this.startRecognition();
  }

  startRecognition() {
    const rec = new Recognition();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += (this.finalText ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      this.interim = interim.trim();
      this.onTranscript(this.text());
    };
    rec.onerror = (e) => {
      this.error = e.error;
    };
    // Some browsers stop listening after a silence; restart while still recording.
    rec.onend = () => {
      if (this.active && !this.error) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      } else this.recEnded?.();
    };
    this.rec = rec;
    rec.start();
  }

  text() {
    return [this.finalText, this.interim].filter(Boolean).join(" ").trim();
  }

  sample() {
    this.analyser.getFloatTimeDomainData(this.buf);
    const rms = Math.sqrt(this.buf.reduce((s, x) => s + x * x, 0) / this.buf.length);
    const pitch = rms > 0.005 ? detectPitch(this.buf, this.ctx.sampleRate) : null;
    this.frames.push({ rms, pitch });
  }

  // Stops recording and returns {text, features}. features is null if there wasn't enough speech.
  async stop() {
    this.active = false;
    clearInterval(this.timer);
    const ended = new Promise((resolve) => {
      this.recEnded = resolve;
      setTimeout(resolve, 1500); // don't hang if the browser never fires 'end'
    });
    try {
      this.rec?.stop();
    } catch {
      /* not running */
    }
    await ended;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    const text = this.text();
    return { text, features: computeFeatures(this.frames, text), error: this.error || null };
  }

  cancel() {
    this.active = false;
    clearInterval(this.timer);
    try {
      this.rec?.abort();
    } catch {
      /* not running */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
  }
}

// Autocorrelation pitch estimate in Hz, or null when the frame isn't clearly voiced.
export function detectPitch(buf, sampleRate) {
  const n = buf.length;
  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), n - 1);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += buf[i] * buf[i];
  if (energy === 0) return null;
  let bestLag = -1;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += buf[i] * buf[i + lag];
    const r = sum / energy;
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return best > 0.5 && bestLag > 0 ? sampleRate / bestLag : null;
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
const round = (x, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function computeFeatures(frames, text) {
  const words = (text.match(/\S+/g) || []).length;
  if (frames.length < 20 || words < 3) return null;
  const rmsAll = frames.map((f) => f.rms);
  const floor = quantile(rmsAll, 0.2);
  const threshold = Math.max(floor * 3, 0.01);
  const voiced = frames.map((f) => f.rms > threshold);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return null;
  const span = voiced.slice(first, last + 1);
  const spanSec = (span.length * FRAME_MS) / 1000;
  const voicedSec = (span.filter(Boolean).length * FRAME_MS) / 1000;
  if (voicedSec < 1.5) return null;

  // Silent stretches of 2+ seconds inside her speech.
  let longPauses = 0;
  let run = 0;
  for (const v of span) {
    if (!v) run++;
    else {
      if (run * FRAME_MS >= 2000) longPauses++;
      run = 0;
    }
  }

  const pitches = frames.filter((f, i) => voiced[i] && f.pitch).map((f) => f.pitch);
  const semis = pitches.map((p) => 12 * Math.log2(p / 100));
  const loud = median(frames.filter((_, i) => voiced[i]).map((f) => f.rms));

  return {
    seconds: round(spanSec, 1),
    words,
    wordsPerMinute: round(words / (spanSec / 60)),
    pausePercent: round((1 - voicedSec / spanSec) * 100),
    longPauses,
    startDelaySec: round((first * FRAME_MS) / 1000, 1),
    pitchHz: pitches.length >= 10 ? round(median(pitches)) : null,
    pitchRangeSemitones: semis.length >= 10 ? round(quantile(semis, 0.9) - quantile(semis, 0.1), 1) : null,
    loudnessDb: round(20 * Math.log10(loud), 1),
  };
}

const KEYS = ["wordsPerMinute", "pausePercent", "pitchRangeSemitones", "loudnessDb"];

// Her usual voice: medians over past recordings from steady check-ins (mood -1 to +1),
// or over everything once there are 5+ recordings and no steady ones yet.
export function baseline(history) {
  const steady = history.filter((h) => typeof h.mood === "number" && Math.abs(h.mood) <= 1);
  const pool = steady.length >= 3 ? steady : history.length >= 5 ? history : [];
  if (!pool.length) return null;
  const out = { samples: pool.length, fromSteadyDays: pool === steady };
  for (const k of KEYS) out[k] = round(median(pool.map((h) => h[k]).filter((v) => typeof v === "number")), 1);
  return out;
}
