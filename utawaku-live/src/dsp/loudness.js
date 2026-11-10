// ITU-R BS.1770-4 / EBU R128 ラウドネスメーター（Momentary / Short-term / Integrated）
import { Biquad } from './biquad.js';

/** 任意サンプルレートの K 特性フィルタ係数（libebur128 と同じ導出） */
export function kWeighting(fs) {
  // stage 1: ハイシェルフ（頭部の音響効果）
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // stage 2: RLB ハイパス
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const s2 = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [s1, s2];
}

export const powerToLufs = (p) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);

export class LoudnessMeter {
  constructor(fs, channels = 2) {
    this.fs = fs;
    this.channels = channels;
    const [s1, s2] = kWeighting(fs);
    this.f1 = Array.from({ length: channels }, () => new Biquad(s1));
    this.f2 = Array.from({ length: channels }, () => new Biquad(s2));
    this.subLen = Math.round(fs * 0.1); // 100ms サブブロック
    this.reset();
  }
  reset() {
    this.acc = 0;
    this.accN = 0;
    this.subs = new Float64Array(30); // 直近3秒
    this.subCount = 0;
    this.subPos = 0;
    this.blocks = []; // 400ms ブロック（75%オーバーラップ）のパワー → Integrated 用
  }
  /** chans: チャンネル毎の Float32Array */
  push(chans, frames) {
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < this.channels; c++) {
        const x = chans[c] ? chans[c][i] : 0;
        const y = this.f2[c].process(this.f1[c].process(x));
        sum += y * y;
      }
      this.acc += sum;
      if (++this.accN >= this.subLen) {
        this.subs[this.subPos] = this.acc / this.subLen;
        this.subPos = (this.subPos + 1) % 30;
        this.subCount++;
        this.acc = 0;
        this.accN = 0;
        if (this.subCount >= 4) {
          this.blocks.push(this._meanSubs(4));
          if (this.blocks.length > 72000) this.blocks.shift(); // 最大2時間
        }
      }
    }
  }
  _meanSubs(n) {
    const k = Math.min(n, this.subCount);
    if (k === 0) return 0;
    let s = 0;
    for (let j = 1; j <= k; j++) s += this.subs[(this.subPos - j + 30) % 30];
    return s / k;
  }
  get momentary() {
    return powerToLufs(this._meanSubs(4));
  }
  get shortTerm() {
    return powerToLufs(this._meanSubs(30));
  }
  get integrated() {
    const absThr = Math.pow(10, (-70 + 0.691) / 10);
    let s = 0;
    let n = 0;
    for (const p of this.blocks) if (p > absThr) { s += p; n++; }
    if (n === 0) return -Infinity;
    const relThr = (s / n) * 0.1; // -10 LU
    let s2 = 0;
    let n2 = 0;
    for (const p of this.blocks) if (p > absThr && p > relThr) { s2 += p; n2++; }
    return n2 ? powerToLufs(s2 / n2) : -Infinity;
  }
}
