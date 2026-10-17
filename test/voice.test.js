import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPitch, computeFeatures, baseline } from "../public/voice.js";
import { buildContext } from "../server/prompt.js";

function tone(hz, sampleRate = 48000, n = 2048) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / sampleRate) + 0.1 * Math.sin((4 * Math.PI * hz * i) / sampleRate);
  return b;
}

test("pitch detection finds the voice pitch within 3%", () => {
  for (const hz of [110, 180, 240]) {
    const p = detectPitch(tone(hz), 48000);
    assert.ok(Math.abs(p - hz) / hz < 0.03, `${hz} -> ${p}`);
  }
  assert.equal(detectPitch(new Float32Array(2048), 48000), null);
});

test("features: speed, pauses, long pauses", () => {
  // 50ms frames: 0.5s silence, 4s speech, 2.5s pause, 4s speech, 0.5s silence
  const f = (on, n, pitch) => Array.from({ length: n }, (_, i) => ({ rms: on ? 0.1 : 0.002, pitch: on ? pitch + (i % 10) : null }));
  const frames = [...f(false, 10), ...f(true, 80, 180), ...f(false, 50), ...f(true, 80, 220), ...f(false, 10)];
  const text = Array(30).fill("word").join(" ");
  const out = computeFeatures(frames, text);
  assert.equal(out.seconds, 10.5);
  assert.equal(out.wordsPerMinute, Math.round(30 / (10.5 / 60)));
  assert.equal(out.pausePercent, Math.round((2.5 / 10.5) * 100));
  assert.equal(out.longPauses, 1);
  assert.equal(out.startDelaySec, 0.5);
  assert.ok(out.pitchRangeSemitones > 2);
});

test("features: nonstop fast talking still counts as speech", () => {
  const frames = Array.from({ length: 80 }, (_, i) => ({ rms: i % 7 === 6 ? 0.03 : 0.12, pitch: 200 + (i % 5) * 5 }));
  const out = computeFeatures(frames, Array(40).fill("word").join(" "));
  assert.ok(out, "features should not be null");
  assert.equal(out.wordsPerMinute, 600);
  assert.ok(out.pausePercent < 20);
});

test("features: too little speech returns null", () => {
  assert.equal(computeFeatures([{ rms: 0.1, pitch: 200 }], "hi there friend"), null);
});

test("baseline prefers steady-mood recordings", () => {
  const h = [
    { mood: 0, wordsPerMinute: 150, pausePercent: 20, pitchRangeSemitones: 6, loudnessDb: -30 },
    { mood: 1, wordsPerMinute: 140, pausePercent: 22, pitchRangeSemitones: 5, loudnessDb: -31 },
    { mood: -1, wordsPerMinute: 160, pausePercent: 18, pitchRangeSemitones: 7, loudnessDb: -29 },
    { mood: 5, wordsPerMinute: 260, pausePercent: 5, pitchRangeSemitones: 12, loudnessDb: -20 },
  ];
  const b = baseline(h);
  assert.equal(b.wordsPerMinute, 150);
  assert.equal(b.fromSteadyDays, true);
  assert.equal(baseline(h.slice(3)), null);
  const ten = [5, 6, 5, 9, 2].map((m, i) => ({ mood10: m, wordsPerMinute: [150, 140, 160, 260, 90][i] }));
  assert.equal(baseline(ten).wordsPerMinute, 150);
  assert.equal(baseline(ten).fromSteadyDays, true);
});

test("context tells Claude speed vs her usual", () => {
  const ctx = buildContext({
    voice: { latest: { wordsPerMinute: 210, pausePercent: 5, longPauses: 0, seconds: 12 }, baseline: { wordsPerMinute: 150, pausePercent: 20, samples: 4, fromSteadyDays: true }, feedback: false },
  });
  assert.match(ctx, /210 words\/min \(her usual 150 words\/min, \+40%\)/);
  assert.match(ctx, /Voice feedback .*: off/);
});
