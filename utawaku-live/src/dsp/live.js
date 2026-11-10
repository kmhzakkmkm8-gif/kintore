// 「ライブのPA/ミックスエンジニアが手でやっていること」を自動化する処理
import { Biquad, rbj } from './biquad.js';
import { EnvelopeFollower, clamp, dbToLin, linToDb, powToDb, timeCoef } from './util.js';
import { kWeighting, powerToLufs } from './loudness.js';

/**
 * ボーカルライダー：伴奏の中域レベルを基準に、ボーカルのフェーダーを自動で上下する。
 * 歌ってみたのMIXで描く「ボリュームオートメーション」のリアルタイム版。
 * 歌っていない時・伴奏が無音の時はゲインを保持する。
 */
export class VocalRider {
  constructor(fs) {
    this.fs = fs;
    const hp = rbj('highpass', fs, 200, 0.7071);
    const lp = rbj('lowpass', fs, 5000, 0.7071);
    this.vf = [new Biquad(hp), new Biquad(lp)];
    this.mf = [new Biquad(hp), new Biquad(lp)];
    this.vms = 0;
    this.mms = 0;
    this.gDb = 0;
    this.targetDb = 0;
    this.detCoef = timeCoef(300, fs);
    this.counter = 0;
    this.set({ offset: 0, range: 6, speed: 400, vocalFloor: -50, enabled: 1 });
  }
  set(p) {
    this.offset = p.offset;
    this.range = p.range;
    this.vocalFloor = p.vocalFloor;
    this.enabled = p.enabled;
    if (p.speed !== this._s) {
      this._s = p.speed;
      this.gCoef = timeCoef(p.speed, this.fs);
    }
  }
  /** v: ボーカル1サンプル, m: 伴奏（モノラル和）1サンプル。ボーカルに掛けるゲイン（リニア）を返す */
  gain(v, m) {
    const vb = this.vf[1].process(this.vf[0].process(v));
    const mb = this.mf[1].process(this.mf[0].process(m));
    this.vms = vb * vb + this.detCoef * (this.vms - vb * vb);
    this.mms = mb * mb + this.detCoef * (this.mms - mb * mb);
    if (++this.counter >= 32) {
      this.counter = 0;
      const vDb = powToDb(this.vms);
      const mDb = powToDb(this.mms);
      if (!this.enabled) this.targetDb = 0;
      else if (vDb > this.vocalFloor && mDb > -60) {
        this.targetDb = clamp(mDb + this.offset - vDb, -this.range, this.range);
      } // それ以外は保持
    }
    this.gDb = this.targetDb + this.gCoef * (this.gDb - this.targetDb);
    return dbToLin(this.gDb);
  }
}

/**
 * フレーズ終わり検出 → ディレイ/リバーブの「センド・スロー」。
 * 一定以上の長さで歌った後、gap ms 以上の無音が続いたら発火し、0..1 の制御信号を出す。
 * 送り側は capture ms だけ遅らせた信号に掛けるので、フレーズ最後の語尾を拾える。
 */
export class PhraseThrow {
  constructor(fs) {
    this.fs = fs;
    this.env = new EnvelopeFollower(fs, 5, 60);
    this.active = 0;
    this.silent = 0;
    this.holdLeft = 0;
    this.out = 0;
    this.triggers = 0;
    this.atkCoef = timeCoef(10, fs);
    this.set({ threshold: -40, gap: 150, minPhrase: 600, hold: 250, release: 500, enabled: 1 });
  }
  set(p) {
    this.threshold = p.threshold;
    this.gapS = Math.round((p.gap / 1000) * this.fs);
    this.minS = Math.round((p.minPhrase / 1000) * this.fs);
    this.holdS = Math.round((p.hold / 1000) * this.fs);
    this.relCoef = timeCoef(p.release, this.fs);
    this.enabled = p.enabled;
  }
  process(x) {
    const lDb = linToDb(this.env.process(x));
    if (lDb > this.threshold) {
      this.active += 1 + (this.silent < this.gapS ? this.silent : 0); // 短い息継ぎはフレーズの一部として数える
      this.silent = 0;
    } else {
      this.silent++;
      if (this.silent === this.gapS) {
        if (this.active >= this.minS && this.enabled) {
          this.holdLeft = this.holdS;
          this.triggers++;
        }
        this.active = 0;
      }
    }
    let target = 0;
    let c = this.relCoef;
    if (this.holdLeft > 0) {
      this.holdLeft--;
      target = 1;
      c = this.atkCoef;
    }
    this.out = target + c * (this.out - target);
    return this.out;
  }
}

/**
 * ボーカル帯域カーブ（Trackspacer 的なダイナミックEQ）：
 * 歌っている間だけ伴奏の 2〜3kHz 付近を数dB下げ、ボーカルの居場所を作る。
 * 出力は BiquadFilter.gain に接続する dB 値（≤0）。
 */
export class CarveControl {
  constructor(fs) {
    this.env = new EnvelopeFollower(fs, 10, 200);
    this.out = 0;
    this.smooth = timeCoef(30, fs);
    this.set({ threshold: -40, depth: 3 });
  }
  set(p) {
    this.threshold = p.threshold;
    this.depth = p.depth;
  }
  process(x) {
    const lDb = linToDb(this.env.process(x));
    const amt = clamp((lDb - this.threshold) / 12, 0, 1);
    const target = -this.depth * amt;
    this.out = target + this.smooth * (this.out - target);
    return this.out;
  }
}

/**
 * 伴奏オートゲイン：YouTubeのカラオケ音源は動画ごとに音量がバラバラなので、
 * K特性の長時間ラウドネスを目標値へゆっくり寄せる（曲中のダイナミクスは潰さない速度）。
 * freeze=1 で現在のゲインを固定（サウンドチェック後に固定する運用）。
 */
export class AutoGain {
  constructor(fs, channels = 2) {
    this.fs = fs;
    this.channels = channels;
    const [s1, s2] = kWeighting(fs);
    this.f1 = Array.from({ length: channels }, () => new Biquad(s1));
    this.f2 = Array.from({ length: channels }, () => new Biquad(s2));
    this.blockLen = Math.round(fs * 0.1);
    this.acc = 0;
    this.accN = 0;
    this.p = 0; // ゲート後の長時間平均パワー
    this.blocks = 0;
    this.gateP = Math.pow(10, (-50 + 0.691) / 10);
    this.gDb = 0;
    this.set({ target: -16, maxGain: 12, slewDbPerSec: 1, enabled: 1, freeze: 0 });
  }
  set(p) {
    this.target = p.target;
    this.maxGain = p.maxGain;
    this.slew = p.slewDbPerSec / this.fs;
    this.enabled = p.enabled;
    this.freeze = p.freeze;
  }
  get loudness() {
    return powerToLufs(this.p);
  }
  _block(bp) {
    // BS.1770 と同様のゲート：絶対 -50 LUFS 未満と、平均より -10 LU 以上小さいブロックを除外
    // （曲間の無音・フェードアウト・広告の合間で平均が引きずられないように）
    if (bp < this.gateP || (this.blocks > 0 && bp < this.p * 0.1)) return;
    this.blocks++;
    // 最初の8秒は単純平均、その後は時定数約8秒の指数平均
    const c = this.blocks < 80 ? 1 - 1 / this.blocks : 1 - 1 / 80;
    this.p = bp + c * (this.p - bp);
  }
  /** 1フレーム分（チャンネル配列のi番目）を処理しゲイン（リニア）を返す */
  frame(chans, i) {
    let s = 0;
    for (let c = 0; c < this.channels; c++) {
      const x = chans[c] ? chans[c][i] : 0;
      const y = this.f2[c].process(this.f1[c].process(x));
      s += y * y;
    }
    this.acc += s;
    if (++this.accN >= this.blockLen) {
      this._block(this.acc / this.blockLen);
      this.acc = 0;
      this.accN = 0;
    }
    if (!this.enabled) {
      this.gDb += clamp(-this.gDb, -this.slew * 20, this.slew * 20);
    } else if (!this.freeze && this.blocks > 0) {
      const want = clamp(this.target - this.loudness, -this.maxGain, this.maxGain);
      this.gDb += clamp(want - this.gDb, -this.slew, this.slew);
    }
    return dbToLin(this.gDb);
  }
  /** 新しい曲に切り替えたときに平均をやり直す（ゲインは保持） */
  relearn() {
    this.blocks = 0;
    this.p = 0;
  }
}
