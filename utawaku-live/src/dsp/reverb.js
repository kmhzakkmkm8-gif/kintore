// リバーブのインパルス応答を生成（ConvolverNode 用）。
// 外部IRファイルを用意しなくても、プレート/ホール/ルームを即座に作れる。
import { mulberry32 } from './util.js';

export const REVERB_TYPES = {
  // density: 初期の拡散の立ち上がり(ms)、er: 初期反射 [ms, gain]
  plate: { onsetMs: 1, damping: 0.35, er: [] },
  hall: { onsetMs: 18, damping: 0.6, er: [[11, 0.5], [19, 0.42], [27, 0.36], [38, 0.3], [52, 0.24], [67, 0.18]] },
  room: { onsetMs: 4, damping: 0.7, er: [[3, 0.6], [7, 0.5], [11, 0.4], [16, 0.32], [22, 0.25]] },
  chamber: { onsetMs: 6, damping: 0.5, er: [[5, 0.45], [9, 0.4], [14, 0.33], [21, 0.27], [29, 0.2]] },
};

/**
 * @param {object} o
 * @param {number} o.sampleRate
 * @param {number} o.decay  RT60（秒）
 * @param {string} o.type   REVERB_TYPES のキー
 * @param {number} [o.damping] 0..1 高域が先に減衰する度合い（未指定ならタイプ既定値）
 * @param {number} [o.width] 0..1 ステレオ幅
 * @param {number} [o.seed]
 * @returns {Float32Array[]} [L, R]
 */
export function generateIR({ sampleRate, decay, type = 'plate', damping, width = 1, seed = 1 }) {
  const t = REVERB_TYPES[type] ?? REVERB_TYPES.plate;
  const damp = damping ?? t.damping;
  const len = Math.max(1, Math.ceil(sampleRate * Math.min(decay * 1.4, 10)));
  const rnd = mulberry32(seed);
  const noise = () => {
    // 3つの一様乱数の和で近似ガウス
    return (rnd() + rnd() + rnd() - 1.5) * 1.15;
  };
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const k = 6.907755 / (decay * sampleRate); // e^(-k n) が RT60 で -60dB
  const onset = Math.max(1, (t.onsetMs / 1000) * sampleRate);
  const fHi = 16000;
  const fLo = 16000 * (1 - damp) + 1500 * damp;
  let yl = 0;
  let yr = 0;
  for (let n = 0; n < len; n++) {
    const env = Math.exp(-k * n) * Math.min(1, n / onset);
    // 時間とともにローパスのカットオフを下げる（空気吸収・壁の高域吸収の近似）
    const prog = Math.min(1, n / (decay * sampleRate));
    const fc = fHi * Math.pow(fLo / fHi, prog);
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
    const common = noise();
    const nl = noise();
    const nr = noise();
    // width=0 でモノ、1 で完全に無相関
    const xl = common * (1 - width) + nl * width;
    const xr = common * (1 - width) + nr * width;
    yl += a * (xl - yl);
    yr += a * (xr - yr);
    // ローパスで減った分のレベルを概ね補償
    const comp = 1 / Math.sqrt(Math.max(a / (2 - a), 1e-4));
    L[n] = yl * env * comp;
    R[n] = yr * env * comp;
  }
  // 初期反射（左右で少しずらす）
  for (const [ms, g] of t.er) {
    const nl = Math.round((ms / 1000) * sampleRate);
    const nr = Math.round(((ms * 1.13) / 1000) * sampleRate);
    if (nl < len) L[nl] += g * (rnd() > 0.5 ? 1 : -1);
    if (nr < len) R[nr] += g * (rnd() > 0.5 ? 1 : -1);
  }
  // 末尾のフェードアウト（切り捨てクリック防止）
  const fade = Math.min(len, Math.round(sampleRate * 0.05));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    L[len - 1 - i] *= g;
    R[len - 1 - i] *= g;
  }
  return [L, R];
}

/** Schroeder 積分から T20 ベースの RT60 を推定（テスト用） */
export function estimateRT60(ir, sampleRate) {
  const n = ir.length;
  const edc = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc += ir[i] * ir[i];
    edc[i] = acc;
  }
  const total = edc[0];
  const db = (i) => 10 * Math.log10(edc[i] / total);
  let i5 = -1;
  let i25 = -1;
  for (let i = 0; i < n; i++) {
    if (i5 < 0 && db(i) <= -5) i5 = i;
    if (i25 < 0 && db(i) <= -25) { i25 = i; break; }
  }
  if (i5 < 0 || i25 < 0) return NaN;
  return ((i25 - i5) / sampleRate) * 3;
}
