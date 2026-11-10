// RBJ Audio EQ Cookbook の双二次フィルタ
export function rbj(type, fs, f0, q = Math.SQRT1_2, gainDb = 0) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(f0, fs * 0.49)) / fs;
  const cs = Math.cos(w0);
  const sn = Math.sin(w0);
  const alpha = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
      a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
      a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cs + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cs);
      b2 = A * (A + 1 - (A - 1) * cs - s);
      a0 = A + 1 + (A - 1) * cs + s;
      a1 = -2 * (A - 1 + (A + 1) * cs);
      a2 = A + 1 + (A - 1) * cs - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cs + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cs);
      b2 = A * (A + 1 + (A - 1) * cs - s);
      a0 = A + 1 - (A - 1) * cs + s;
      a1 = 2 * (A - 1 - (A + 1) * cs);
      a2 = A + 1 - (A - 1) * cs - s;
      break;
    }
    default:
      throw new Error(`unknown filter type: ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 転置直接形II */
export class Biquad {
  constructor(c) {
    this.z1 = 0;
    this.z2 = 0;
    this.set(c ?? { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });
  }
  set(c) {
    this.b0 = c.b0; this.b1 = c.b1; this.b2 = c.b2; this.a1 = c.a1; this.a2 = c.a2;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    if (this.z1 > -1e-20 && this.z1 < 1e-20) this.z1 = 0; // デノーマル対策
    if (this.z2 > -1e-20 && this.z2 < 1e-20) this.z2 = 0;
    return y;
  }
  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/** 係数の周波数 f における振幅特性（テスト・表示用） */
export function magnitudeAt(c, f, fs) {
  const w = (2 * Math.PI * f) / fs;
  const cr = (k) => Math.cos(k * w);
  const si = (k) => -Math.sin(k * w);
  const nr = c.b0 + c.b1 * cr(1) + c.b2 * cr(2);
  const ni = c.b1 * si(1) + c.b2 * si(2);
  const dr = 1 + c.a1 * cr(1) + c.a2 * cr(2);
  const di = c.a1 * si(1) + c.a2 * si(2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}
