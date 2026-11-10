import test from 'node:test';
import assert from 'node:assert/strict';
import { rbj, magnitudeAt, Biquad } from '../src/dsp/biquad.js';
import { gainComputer, Compressor, Expander, DeEsser, Saturator } from '../src/dsp/dynamics.js';
import { LookaheadLimiter } from '../src/dsp/limiter.js';
import { LoudnessMeter } from '../src/dsp/loudness.js';
import { VocalRider, PhraseThrow, CarveControl, AutoGain } from '../src/dsp/live.js';
import { generateIR, estimateRT60 } from '../src/dsp/reverb.js';
import { dbToLin, linToDb, mulberry32 } from '../src/dsp/util.js';

const FS = 48000;
const sine = (f, amp, seconds, fs = FS) => {
  const n = Math.round(seconds * fs);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * f * i) / fs);
  return a;
};
const rms = (a, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}±${tol}, got ${a}`);

test('biquad: peaking/shelf/HPF の振幅特性', () => {
  near(linToDb(magnitudeAt(rbj('peaking', FS, 3000, 1, 4), 3000, FS)), 4, 0.01);
  near(linToDb(magnitudeAt(rbj('highshelf', FS, 10000, 0.707, 3), 20000, FS)), 3, 0.3);
  near(linToDb(magnitudeAt(rbj('lowshelf', FS, 150, 0.707, -3), 30, FS)), -3, 0.3);
  near(linToDb(magnitudeAt(rbj('highpass', FS, 100, 0.7071), 100, FS)), -3.01, 0.05);
  // 実際のフィルタ処理と一致
  const f = new Biquad(rbj('lowpass', FS, 1000));
  const y = sine(4000, 1, 0.5).map((x) => f.process(x));
  near(linToDb(rms(y, FS * 0.2) * Math.SQRT2), linToDb(magnitudeAt(rbj('lowpass', FS, 1000), 4000, FS)), 0.1);
});

test('gainComputer: 静特性とソフトニー', () => {
  assert.equal(gainComputer(-30, -20, 4, 0), 0);
  near(gainComputer(-8, -20, 4, 0), -9, 1e-9); // 12dB超過 → 3dB に圧縮
  near(gainComputer(-20, -20, 4, 6), (-0.75 * 9) / 12, 1e-9); // ニー中央
  // ニー境界で連続
  near(gainComputer(-17, -20, 4, 6), gainComputer(-17 + 1e-9, -20, 4, 0), 1e-6);
});

test('compressor: 定常サインで静特性どおりのゲインリダクション', () => {
  const c = new Compressor(FS);
  c.set({ threshold: -20, ratio: 4, knee: 0, attack: 5, release: 50, makeup: 0, detector: 0 });
  const x = sine(1000, dbToLin(-8), 1);
  let g = 1;
  for (const s of x) g = c.gain(Math.abs(s));
  // ピーク検波はサイン波の谷で僅かに戻るので許容幅をとる
  near(linToDb(g), -9, 1.0);
  const r = new Compressor(FS);
  r.set({ threshold: -20, ratio: 4, knee: 0, attack: 10, release: 100, makeup: 0, detector: 1 });
  for (const s of x) g = r.gain(Math.abs(s));
  near(linToDb(g), -9, 0.3, 'RMS検波');
});

test('expander: 閾値以下を減衰し、上では素通し', () => {
  const e = new Expander(FS);
  e.set({ threshold: -50, range: 20, ratio: 3, attack: 1, hold: 50, release: 50 });
  let g;
  for (const s of sine(500, dbToLin(-20), 0.5)) g = e.gain(s);
  near(linToDb(g), 0, 0.01);
  for (const s of sine(500, dbToLin(-80), 1)) g = e.gain(s);
  near(linToDb(g), -20, 0.1, 'range で頭打ち');
});

test('de-esser: 歯擦音帯域だけを下げる', () => {
  const run = (f) => {
    const d = new DeEsser(FS);
    d.set({ frequency: 6000, threshold: -30, ratio: 4, maxReduction: 10 });
    const x = sine(f, dbToLin(-6), 0.5);
    const y = x.map((s) => d.process(s));
    return linToDb(rms(y, FS * 0.25) / rms(x, FS * 0.25));
  };
  near(run(300), 0, 0.2, '低域は変化なし');
  assert.ok(run(9000) < -6, '9kHzは大きく下がる');
});

test('saturator: 小信号は透過、大信号は tanh で頭打ち', () => {
  const s = new Saturator();
  s.set({ drive: 12, mix: 1 });
  let y = 0;
  for (const x of sine(200, 0.001, 0.1)) y = Math.max(y, Math.abs(s.process(x)));
  near(y, 0.001, 0.0001);
  const s2 = new Saturator();
  s2.set({ drive: 12, mix: 1 });
  let p = 0;
  for (const x of sine(200, 1, 0.1)) p = Math.max(p, Math.abs(s2.process(x)));
  assert.ok(p < 0.26, `出力ピーク ${p}`); // tanh(4)/4 ≈ 0.25
});

test('limiter: どんな入力でも ceiling を超えず、レイテンシ分だけ遅れる', () => {
  const L = new LookaheadLimiter(FS, 2, 3);
  L.set({ ceiling: -1, release: 50 });
  const rnd = mulberry32(42);
  const n = FS;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const burst = (i % 4800) < 200 ? 8 : 0.3;
    l[i] = (rnd() * 2 - 1) * burst;
    r[i] = (rnd() * 2 - 1) * burst * 0.5;
  }
  const ol = new Float32Array(n);
  const or = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    const f = Math.min(128, n - i);
    L.process([l.subarray(i, i + f), r.subarray(i, i + f)], [ol.subarray(i, i + f), or.subarray(i, i + f)], f);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ol[i]), Math.abs(or[i]));
  assert.ok(peak <= dbToLin(-1) + 1e-6, `peak ${linToDb(peak)} dBFS`);
  // 閾値以下の信号は遅延して素通し
  const L2 = new LookaheadLimiter(FS, 1, 3);
  const x = sine(440, 0.5, 0.05);
  const y = new Float32Array(x.length);
  L2.process([x], [y], x.length);
  const d = L2.latency;
  for (let i = d; i < x.length; i++) near(y[i], x[i - d], 1e-6);
});

test('loudness: 1kHz サイン片チャンネルは -3.01 + 20log10(A) LUFS', () => {
  const m = new LoudnessMeter(FS, 2);
  const x = sine(1000, 0.5, 4);
  const silent = new Float32Array(x.length);
  m.push([x, silent], x.length);
  near(m.momentary, -3.01 + linToDb(0.5), 0.1);
  near(m.shortTerm, -3.01 + linToDb(0.5), 0.1);
  near(m.integrated, -3.01 + linToDb(0.5), 0.1);
});

test('rider: ボーカルを伴奏+offset に寄せ、range で制限', () => {
  const r = new VocalRider(FS);
  r.set({ offset: 0, range: 6, speed: 100, vocalFloor: -50, enabled: 1 });
  const v = sine(1000, dbToLin(-24), 2);
  const m = sine(1500, dbToLin(-20), 2);
  let g;
  for (let i = 0; i < v.length; i++) g = r.gain(v[i], m[i]);
  near(linToDb(g), 4, 0.5);
  const r2 = new VocalRider(FS);
  r2.set({ offset: 0, range: 6, speed: 100, vocalFloor: -50, enabled: 1 });
  const v2 = sine(1000, dbToLin(-35), 2);
  for (let i = 0; i < v2.length; i++) g = r2.gain(v2[i], m[i]);
  near(linToDb(g), 6, 0.3, 'range 上限');
});

test('phrase throw: 長いフレーズの後だけ発火し、息継ぎでは発火しない', () => {
  const t = new PhraseThrow(FS);
  t.set({ threshold: -40, gap: 150, minPhrase: 600, hold: 250, release: 300, enabled: 1 });
  const seg = (amp, sec) => sine(300, amp, sec);
  const parts = [seg(0.3, 0.5), seg(0, 0.08), seg(0.3, 0.5), seg(0, 1.0), seg(0.3, 0.2), seg(0, 1.0)];
  let maxOut = 0;
  for (const p of parts) for (const s of p) maxOut = Math.max(maxOut, t.process(s));
  assert.equal(t.triggers, 1, '1.08秒のフレーズ後のみ（0.2秒の短い発声では発火しない）');
  assert.ok(maxOut > 0.95);
});

test('carve: 歌っている間だけ depth dB 下げる', () => {
  const c = new CarveControl(FS);
  c.set({ threshold: -40, depth: 4 });
  let o = 0;
  for (const s of sine(500, 0.3, 0.5)) o = c.process(s);
  near(o, -4, 0.05);
  for (const s of new Float32Array(FS)) o = c.process(s);
  near(o, 0, 0.05);
});

test('autogain: 目標ラウドネスへ寄せ、無音ではゲインを保持', () => {
  const a = new AutoGain(FS, 1);
  a.set({ target: -16, maxGain: 12, slewDbPerSec: 4, enabled: 1, freeze: 0 });
  const x = sine(1000, dbToLin(-24 + 3.01), 12); // ≈ -24 LUFS（モノ1ch）
  let g;
  for (let i = 0; i < x.length; i++) g = a.frame([x], i);
  near(linToDb(g), 8, 0.5);
  const silent = new Float32Array(FS * 3);
  for (let i = 0; i < silent.length; i++) g = a.frame([silent], i);
  near(linToDb(g), 8, 0.5, '無音で保持');
});

test('reverb IR: 指定した RT60 で減衰する', () => {
  for (const decay of [0.8, 2.0]) {
    const [L, R] = generateIR({ sampleRate: FS, decay, type: 'plate', damping: 0 });
    near(estimateRT60(L, FS), decay, decay * 0.15, `L ${decay}s`);
    near(estimateRT60(R, FS), decay, decay * 0.15, `R ${decay}s`);
    assert.ok(L.every(Number.isFinite));
  }
});
