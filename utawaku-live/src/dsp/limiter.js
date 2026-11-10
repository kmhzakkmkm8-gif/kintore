// 先読みブリックウォール・リミッター
// 1) 各サンプルの必要ゲイン r = min(1, ceiling/|x|) を求め
// 2) 直近 N サンプルの最小値をホールド（単調deque）
// 3) リリースを平滑化（上昇方向のみ遅くする＝安全側）
// 4) 長さ N の移動平均で滑らかにし、信号を N-1 サンプル遅らせて掛ける
// → 移動平均の窓に必ず該当サンプルのホールド区間が入るため、出力は ceiling を超えない。
import { dbToLin, timeCoef } from './util.js';

export class LookaheadLimiter {
  constructor(fs, channels = 2, lookaheadMs = 3) {
    this.fs = fs;
    this.channels = channels;
    this.N = Math.max(2, Math.round((lookaheadMs / 1000) * fs));
    const N = this.N;
    this.delay = Array.from({ length: channels }, () => new Float64Array(N));
    this.w = 0;
    this.dqVal = new Float64Array(N + 1);
    this.dqIdx = new Float64Array(N + 1);
    this.dqHead = 0;
    this.dqTail = 0;
    this.box = new Float64Array(N).fill(1);
    this.boxSum = N;
    this.boxPos = 0;
    this.n = 0;
    this.e = 1;
    this.gainNow = 1;
    this.set({ ceiling: -1, release: 80 });
  }
  get latency() {
    return this.N - 1;
  }
  set(p) {
    this.ceilingLin = dbToLin(p.ceiling);
    this.rc = timeCoef(p.release, this.fs);
  }
  _dqPush(v, idx) {
    const cap = this.N + 1;
    while (this.dqHead !== this.dqTail) {
      const back = (this.dqTail - 1 + cap) % cap;
      if (this.dqVal[back] >= v) this.dqTail = back;
      else break;
    }
    this.dqVal[this.dqTail] = v;
    this.dqIdx[this.dqTail] = idx;
    this.dqTail = (this.dqTail + 1) % cap;
    while (this.dqIdx[this.dqHead] <= idx - this.N) this.dqHead = (this.dqHead + 1) % cap;
    return this.dqVal[this.dqHead];
  }
  /** inputs/outputs: Float32Array の配列（チャンネル毎）。in-place 可。 */
  process(inputs, outputs, frames) {
    const C = this.channels;
    const N = this.N;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < C; c++) {
        const x = inputs[c] ? inputs[c][i] : 0;
        const a = x < 0 ? -x : x;
        if (a > peak) peak = a;
      }
      const r = peak > this.ceilingLin ? this.ceilingLin / peak : 1;
      const h = this._dqPush(r, this.n++);
      this.e = h < this.e ? h : h + this.rc * (this.e - h);
      this.boxSum += this.e - this.box[this.boxPos];
      this.box[this.boxPos] = this.e;
      this.boxPos = (this.boxPos + 1) % N;
      if (this.boxPos === 0) {
        // 浮動小数の累積誤差を定期的にリセット
        let s = 0;
        for (let k = 0; k < N; k++) s += this.box[k];
        this.boxSum = s;
      }
      const g = Math.min(1, this.boxSum / N);
      this.gainNow = g;
      const readPos = (this.w + 1) % N;
      for (let c = 0; c < C; c++) {
        const buf = this.delay[c];
        buf[this.w] = inputs[c] ? inputs[c][i] : 0;
        if (outputs[c]) outputs[c][i] = buf[readPos] * g;
      }
      this.w = readPos;
    }
  }
}
