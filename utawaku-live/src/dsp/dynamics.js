// ダイナミクス系（コンプ・ゲート/エキスパンダー・ディエッサー・サチュレーター）
import { Biquad, rbj } from './biquad.js';
import { EnvelopeFollower, dbToLin, linToDb, timeCoef } from './util.js';

/**
 * ソフトニー付きの静特性。入力レベル(dB)に対するゲイン変化(dB, ≤0)を返す。
 * Giannoulis, Massberg, Reiss (2012) "Digital Dynamic Range Compressor Design"
 */
export function gainComputer(xDb, thr, ratio, knee) {
  const over = xDb - thr;
  const slope = 1 / ratio - 1;
  if (knee > 0 && 2 * Math.abs(over) <= knee) {
    const t = over + knee / 2;
    return (slope * t * t) / (2 * knee);
  }
  return over > 0 ? over * slope : 0;
}

/**
 * フィードフォワード・コンプレッサー。
 * detector: 0=ピーク（速い、1176的）、1=RMS（滑らか、LA-2A的なレベリング）
 * リリースはゲインリダクション量に応じて伸びる（プログラム依存リリース）。
 */
export class Compressor {
  constructor(fs) {
    this.fs = fs;
    this.gr = 0; // 現在のゲインリダクション(dB, 正)
    this.ms = 0;
    this.rmsCoef = timeCoef(10, fs);
    this.set({ threshold: -18, ratio: 4, knee: 6, attack: 5, release: 100, makeup: 0, detector: 0 });
  }
  set(p) {
    this.threshold = p.threshold;
    this.ratio = Math.max(1, p.ratio);
    this.knee = p.knee;
    this.makeup = p.makeup;
    this.detector = p.detector;
    if (p.attack !== this._a || p.release !== this._r) {
      this._a = p.attack;
      this._r = p.release;
      this.ca = timeCoef(p.attack, this.fs);
      this.cr = timeCoef(p.release, this.fs);
      this.crSlow = timeCoef(p.release * 3, this.fs);
    }
  }
  /** level は検波対象の絶対値（リンク時はチャンネル最大値）。出力ゲイン（リニア）を返す */
  gain(level) {
    let x = level;
    if (this.detector >= 0.5) {
      this.ms = x * x + this.rmsCoef * (this.ms - x * x);
      x = Math.sqrt(this.ms) * Math.SQRT2; // サイン波でピークと同等の値になるよう補正
    }
    const target = -gainComputer(linToDb(x), this.threshold, this.ratio, this.knee);
    let c;
    if (target > this.gr) c = this.ca;
    else c = this.gr > 6 ? this.crSlow : this.cr; // 深く潰した後はゆっくり戻す
    this.gr = target + c * (this.gr - target);
    return dbToLin(this.makeup - this.gr);
  }
}

/** ダウンワード・エキスパンダー（自然なノイズゲート）。ホールド付き。 */
export class Expander {
  constructor(fs) {
    this.fs = fs;
    this.env = new EnvelopeFollower(fs, 0.5, 40);
    this.gr = 0;
    this.holdLeft = 0;
    this.set({ threshold: -55, range: 15, ratio: 3, attack: 1, hold: 80, release: 150 });
  }
  set(p) {
    this.threshold = p.threshold;
    this.range = Math.max(0, p.range);
    this.ratio = Math.max(1, p.ratio);
    this.holdSamples = Math.round((p.hold / 1000) * this.fs);
    this.ca = timeCoef(p.attack, this.fs);
    this.cr = timeCoef(p.release, this.fs);
  }
  gain(x) {
    const lDb = linToDb(this.env.process(x));
    let target = 0;
    if (this.range > 0 && lDb < this.threshold) {
      target = Math.min(this.range, (this.threshold - lDb) * (this.ratio - 1));
    }
    if (target <= this.gr) {
      this.holdLeft = this.holdSamples;
      this.gr = target + this.ca * (this.gr - target);
    } else if (this.holdLeft > 0) {
      this.holdLeft--;
    } else {
      this.gr = target + this.cr * (this.gr - target);
    }
    return dbToLin(-this.gr);
  }
}

/**
 * ダイナミック・ハイシェルフ型ディエッサー。
 * 高域（HPF）で歯擦音を検出し、その量だけハイシェルフを下げる。減衰0dBのときシェルフは恒等なので音質を変えない。
 */
export class DeEsser {
  constructor(fs) {
    this.fs = fs;
    this.hp = new Biquad();
    this.shelf = new Biquad();
    this.env = new EnvelopeFollower(fs, 0.3, 40);
    this.gr = 0;
    this.applied = 0;
    this.counter = 0;
    this.set({ frequency: 6500, threshold: -30, ratio: 4, maxReduction: 10 });
  }
  set(p) {
    if (p.frequency !== this._f) {
      this._f = p.frequency;
      this.hp.set(rbj('highpass', this.fs, p.frequency, 0.7071));
      this.applied = NaN; // シェルフ係数を再計算させる
    }
    this.threshold = p.threshold;
    this.ratio = Math.max(1, p.ratio);
    this.maxReduction = p.maxReduction;
  }
  process(x) {
    const h = this.hp.process(x);
    const lDb = linToDb(this.env.process(h));
    let red = 0;
    if (lDb > this.threshold) red = Math.min(this.maxReduction, (lDb - this.threshold) * (1 - 1 / this.ratio));
    this.gr = red;
    if (++this.counter >= 16) {
      this.counter = 0;
      if (!(Math.abs(red - this.applied) < 0.05)) {
        this.applied = red;
        this.shelf.set(rbj('highshelf', this.fs, this._f * 0.8, 0.7071, -red));
      }
    }
    return this.shelf.process(x);
  }
}

/** log(cosh(x)) をオーバーフローなしで計算（tanh の原始関数） */
export function logCosh(x) {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
}

/**
 * tanh サチュレーター。1次 ADAA（アンチデリバティブ・アンチエイリアシング）で
 * オーバーサンプリングなしでも折り返しノイズを抑える。並列ミックス内蔵。
 */
export class Saturator {
  constructor() {
    this.xPrev = 0;
    this.fPrev = 0;
    this.dryPrev = 0;
    this.set({ drive: 6, mix: 0.2 });
  }
  set(p) {
    this.driveLin = dbToLin(p.drive);
    this.mix = p.mix;
  }
  process(input) {
    const x = input * this.driveLin;
    const f = logCosh(x);
    const dx = x - this.xPrev;
    const wet = Math.abs(dx) > 1e-6 ? (f - this.fPrev) / dx : Math.tanh(0.5 * (x + this.xPrev));
    this.xPrev = x;
    this.fPrev = f;
    // ADAA は半サンプル遅れるので、ドライ側も半サンプル平均して位相を揃える
    const dry = 0.5 * (input + this.dryPrev);
    this.dryPrev = input;
    return dry * (1 - this.mix) + (wet / this.driveLin) * this.mix;
  }
}
