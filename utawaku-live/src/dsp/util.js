// 共通ユーティリティ（AudioWorklet とメインスレッドの両方から import される純粋関数のみ）

export const dbToLin = (db) => Math.pow(10, db / 20);
export const linToDb = (x) => (x > 1e-10 ? 20 * Math.log10(x) : -200);
export const powToDb = (p) => (p > 1e-20 ? 10 * Math.log10(p) : -200);
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** 時定数 ms の1次平滑係数（y = x + c*(y-x)） */
export const timeCoef = (ms, fs) => (ms <= 0 ? 0 : Math.exp(-1 / (ms * 0.001 * fs)));

/** ピーク検波のエンベロープフォロワー（アタック/リリース独立） */
export class EnvelopeFollower {
  constructor(fs, attackMs = 1, releaseMs = 50) {
    this.fs = fs;
    this.env = 0;
    this.setTimes(attackMs, releaseMs);
  }
  setTimes(attackMs, releaseMs) {
    if (attackMs === this._a && releaseMs === this._r) return;
    this._a = attackMs;
    this._r = releaseMs;
    this.ca = timeCoef(attackMs, this.fs);
    this.cr = timeCoef(releaseMs, this.fs);
  }
  process(x) {
    const a = x < 0 ? -x : x;
    const c = a > this.env ? this.ca : this.cr;
    this.env = a + c * (this.env - a);
    return this.env;
  }
}

/** 決定的な乱数（IR生成をテスト可能にするため） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
