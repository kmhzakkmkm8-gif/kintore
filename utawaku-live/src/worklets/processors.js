// AudioWorklet プロセッサ群。DSP 本体は ../dsp/ の純粋クラス（node --test でテスト済み）。
import { Compressor, Expander, DeEsser, Saturator } from '../dsp/dynamics.js';
import { LookaheadLimiter } from '../dsp/limiter.js';
import { LoudnessMeter } from '../dsp/loudness.js';
import { VocalRider, PhraseThrow, CarveControl, AutoGain } from '../dsp/live.js';

const REPORT_EVERY = 2400; // 約50msごとにメインスレッドへ状態を送る

/** k-rate AudioParam 配列から現在値を {name: value} で取り出す */
const read = (parameters, names) => {
  const o = {};
  for (const n of names) o[n] = parameters[n][0];
  return o;
};
const desc = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });

class Base extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sinceReport = 0;
    this.alive = true;
    this.port.onmessage = (e) => this.onMessage?.(e.data);
  }
  report(frames, payload) {
    this.sinceReport += frames;
    if (this.sinceReport >= REPORT_EVERY) {
      this.sinceReport = 0;
      this.port.postMessage(payload());
    }
  }
}

/** モノ/ステレオのリンク型コンプレッサー */
class CompressorProcessor extends Base {
  static get parameterDescriptors() {
    return [
      desc('threshold', -18, -60, 0), desc('ratio', 4, 1, 20), desc('knee', 6, 0, 24),
      desc('attack', 5, 0.05, 200), desc('release', 100, 5, 2000), desc('makeup', 0, -12, 24),
      desc('detector', 0, 0, 1), desc('bypass', 0, 0, 1),
    ];
  }
  constructor() {
    super();
    this.c = new Compressor(sampleRate);
    this.names = ['threshold', 'ratio', 'knee', 'attack', 'release', 'makeup', 'detector'];
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0];
    const out = outputs[0];
    const frames = out[0].length;
    if (inp.length === 0) { for (const o of out) o.fill(0); return true; }
    this.c.set(read(parameters, this.names));
    const bypass = parameters.bypass[0] >= 0.5;
    for (let i = 0; i < frames; i++) {
      let lvl = 0;
      for (let ch = 0; ch < inp.length; ch++) { const a = Math.abs(inp[ch][i]); if (a > lvl) lvl = a; }
      const g = this.c.gain(lvl);
      for (let ch = 0; ch < out.length; ch++) {
        const x = (inp[ch] ?? inp[0])[i];
        out[ch][i] = bypass ? x : x * g;
      }
    }
    this.report(frames, () => ({ gr: bypass ? 0 : this.c.gr }));
    return true;
  }
}

class ExpanderProcessor extends Base {
  static get parameterDescriptors() {
    return [desc('threshold', -55, -90, -10), desc('range', 15, 0, 60), desc('ratio', 3, 1, 10),
      desc('attack', 1, 0.1, 50), desc('hold', 80, 0, 500), desc('release', 150, 10, 2000)];
  }
  constructor() {
    super();
    this.e = new Expander(sampleRate);
    this.names = ['threshold', 'range', 'ratio', 'attack', 'hold', 'release'];
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0][0];
    const out = outputs[0][0];
    if (!inp) { out.fill(0); return true; }
    this.e.set(read(parameters, this.names));
    for (let i = 0; i < out.length; i++) out[i] = inp[i] * this.e.gain(inp[i]);
    this.report(out.length, () => ({ gr: this.e.gr }));
    return true;
  }
}

class DeEsserProcessor extends Base {
  static get parameterDescriptors() {
    return [desc('frequency', 6500, 2000, 12000), desc('threshold', -30, -60, 0), desc('ratio', 4, 1, 20), desc('maxReduction', 10, 0, 24)];
  }
  constructor() {
    super();
    this.d = new DeEsser(sampleRate);
    this.names = ['frequency', 'threshold', 'ratio', 'maxReduction'];
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0][0];
    const out = outputs[0][0];
    if (!inp) { out.fill(0); return true; }
    this.d.set(read(parameters, this.names));
    let maxGr = 0;
    for (let i = 0; i < out.length; i++) { out[i] = this.d.process(inp[i]); if (this.d.gr > maxGr) maxGr = this.d.gr; }
    this.peakGr = Math.max(this.peakGr ?? 0, maxGr);
    this.report(out.length, () => { const g = this.peakGr; this.peakGr = 0; return { gr: g }; });
    return true;
  }
}

class SaturatorProcessor extends Base {
  static get parameterDescriptors() {
    return [desc('drive', 6, 0, 30), desc('mix', 0.2, 0, 1)];
  }
  constructor() {
    super();
    this.s = new Saturator();
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0][0];
    const out = outputs[0][0];
    if (!inp) { out.fill(0); return true; }
    this.s.set({ drive: parameters.drive[0], mix: parameters.mix[0] });
    for (let i = 0; i < out.length; i++) out[i] = this.s.process(inp[i]);
    return true;
  }
}

/** 入力0: ボーカル(モノ), 入力1: 伴奏(サイドチェーン) */
class RiderProcessor extends Base {
  static get parameterDescriptors() {
    return [desc('offset', 0, -20, 20), desc('range', 6, 0, 18), desc('speed', 400, 20, 5000),
      desc('vocalFloor', -50, -90, -10), desc('enabled', 1, 0, 1)];
  }
  constructor() {
    super();
    this.r = new VocalRider(sampleRate);
    this.names = ['offset', 'range', 'speed', 'vocalFloor', 'enabled'];
  }
  process(inputs, outputs, parameters) {
    const v = inputs[0][0];
    const m = inputs[1];
    const out = outputs[0][0];
    if (!v) { out.fill(0); return true; }
    this.r.set(read(parameters, this.names));
    for (let i = 0; i < out.length; i++) {
      let ms = 0;
      for (let ch = 0; ch < m.length; ch++) ms += m[ch][i];
      if (m.length > 1) ms /= m.length;
      out[i] = v[i] * this.r.gain(v[i], ms);
    }
    this.report(out.length, () => ({ gain: this.r.gDb }));
    return true;
  }
}

/** 出力: スロー量 0..1（GainNode.gain に接続） */
class ThrowProcessor extends Base {
  static get parameterDescriptors() {
    return [desc('threshold', -40, -80, -10), desc('gap', 150, 30, 1000), desc('minPhrase', 600, 0, 5000),
      desc('hold', 250, 20, 2000), desc('release', 500, 20, 5000), desc('enabled', 1, 0, 1)];
  }
  constructor() {
    super();
    this.t = new PhraseThrow(sampleRate);
    this.names = ['threshold', 'gap', 'minPhrase', 'hold', 'release', 'enabled'];
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0][0];
    const out = outputs[0][0];
    this.t.set(read(parameters, this.names));
    for (let i = 0; i < out.length; i++) out[i] = this.t.process(inp ? inp[i] : 0);
    this.report(out.length, () => ({ throw: this.t.out, triggers: this.t.triggers }));
    return true;
  }
}

/** 出力: dB 値（≤0）。BiquadFilter(peaking).gain に接続 */
class CarveProcessor extends Base {
  static get parameterDescriptors() {
    return [desc('threshold', -40, -80, -10), desc('depth', 3, 0, 12)];
  }
  constructor() {
    super();
    this.c = new CarveControl(sampleRate);
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0][0];
    const out = outputs[0][0];
    this.c.set({ threshold: parameters.threshold[0], depth: parameters.depth[0] });
    for (let i = 0; i < out.length; i++) out[i] = this.c.process(inp ? inp[i] : 0);
    this.report(out.length, () => ({ carve: this.c.out }));
    return true;
  }
}

class AutoGainProcessor extends Base {
  static get parameterDescriptors() {
    return [desc('target', -16, -30, -6), desc('maxGain', 12, 0, 24), desc('slewDbPerSec', 1, 0.05, 20),
      desc('enabled', 1, 0, 1), desc('freeze', 0, 0, 1)];
  }
  constructor() {
    super();
    this.a = new AutoGain(sampleRate, 2);
    this.names = ['target', 'maxGain', 'slewDbPerSec', 'enabled', 'freeze'];
  }
  onMessage(m) {
    if (m === 'relearn') this.a.relearn();
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0];
    const out = outputs[0];
    const frames = out[0].length;
    if (inp.length === 0) { for (const o of out) o.fill(0); return true; }
    this.a.set(read(parameters, this.names));
    const chans = [inp[0], inp[1] ?? inp[0]];
    for (let i = 0; i < frames; i++) {
      const g = this.a.frame(chans, i);
      out[0][i] = chans[0][i] * g;
      out[1][i] = chans[1][i] * g;
    }
    this.report(frames, () => ({ gain: this.a.gDb, lufs: this.a.loudness }));
    return true;
  }
}

class LimiterProcessor extends Base {
  static get parameterDescriptors() {
    return [desc('ceiling', -1, -12, 0), desc('release', 80, 5, 1000)];
  }
  constructor() {
    super();
    this.l = new LookaheadLimiter(sampleRate, 2, 3);
    this.minGain = 1;
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0];
    const out = outputs[0];
    const frames = out[0].length;
    this.l.set({ ceiling: parameters.ceiling[0], release: parameters.release[0] });
    const chans = inp.length ? [inp[0], inp[1] ?? inp[0]] : [null, null];
    this.l.process(chans, out, frames);
    this.minGain = Math.min(this.minGain, this.l.gainNow);
    this.report(frames, () => { const g = this.minGain; this.minGain = 1; return { gr: -20 * Math.log10(g) }; });
    return true;
  }
}

/** ピーク/RMS と（任意で）ラウドネス。素通し出力も持つ（グラフを引っ張るため） */
class MeterProcessor extends Base {
  constructor(options) {
    super();
    this.loud = options?.processorOptions?.loudness ? new LoudnessMeter(sampleRate, 2) : null;
    this.peak = [0, 0];
    this.sq = [0, 0];
    this.n = 0;
    this.clip = false;
  }
  onMessage(m) {
    if (m === 'reset' && this.loud) this.loud.reset();
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const frames = out[0].length;
    if (inp.length === 0) {
      for (const o of out) o.fill(0);
    } else {
      for (let ch = 0; ch < out.length; ch++) out[ch].set(inp[ch] ?? inp[0]);
      for (let ch = 0; ch < 2; ch++) {
        const x = inp[ch] ?? inp[0];
        let p = this.peak[ch];
        let s = 0;
        for (let i = 0; i < frames; i++) { const a = Math.abs(x[i]); if (a > p) p = a; s += x[i] * x[i]; }
        this.peak[ch] = p;
        this.sq[ch] += s;
        if (p >= 0.999) this.clip = true;
      }
      this.n += frames;
      if (this.loud) this.loud.push([inp[0], inp[1] ?? inp[0]], frames);
    }
    this.report(frames, () => {
      const n = Math.max(1, this.n);
      const msg = {
        peak: [this.peak[0], this.peak[1]],
        rms: [Math.sqrt(this.sq[0] / n), Math.sqrt(this.sq[1] / n)],
        clip: this.clip,
      };
      if (this.loud) {
        msg.m = this.loud.momentary;
        msg.s = this.loud.shortTerm;
        msg.i = this.loud.integrated;
      }
      this.peak = [0, 0];
      this.sq = [0, 0];
      this.n = 0;
      this.clip = false;
      return msg;
    });
    return true;
  }
}

registerProcessor('ul-compressor', CompressorProcessor);
registerProcessor('ul-expander', ExpanderProcessor);
registerProcessor('ul-deesser', DeEsserProcessor);
registerProcessor('ul-saturator', SaturatorProcessor);
registerProcessor('ul-rider', RiderProcessor);
registerProcessor('ul-throw', ThrowProcessor);
registerProcessor('ul-carve', CarveProcessor);
registerProcessor('ul-autogain', AutoGainProcessor);
registerProcessor('ul-limiter', LimiterProcessor);
registerProcessor('ul-meter', MeterProcessor);
