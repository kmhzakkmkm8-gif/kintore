// 音声グラフ本体。Web Audio のネイティブノード（EQ・ディレイ・コンボリューション）と
// 自作 AudioWorklet（ダイナミクス・自動化）で「ライブ卓＋歌ってみたMIX」を組む。
import { generateIR } from './dsp/reverb.js';
import { dbToLin } from './dsp/util.js';
import { DEFAULTS, PARAMS, PARAM_MAP, noteSeconds } from './params.js';

const CAPTURE = 0.35; // スロー用：語尾を拾うために送りを遅らせる時間(s)
const BW = -3.0103; // Web Audio の LP/HP の Q は dB 指定（バターワース）

const offDb = (v) => (v <= -60 ? 0 : dbToLin(v));

export class Engine {
  constructor() {
    this.values = { ...DEFAULTS };
    this.stats = {};
    this.ctx = null;
    this.listeners = new Set();
    this.music = { kind: null, label: '未接続' };
    this.mic = { label: '未接続', channels: 0, latency: 0 };
    this.recorder = null;
    this._revTimer = null;
    this._revActive = 0;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  async start(values) {
    if (this.ctx) return;
    Object.assign(this.values, values);
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(new URL('./worklets/processors.js', import.meta.url));
    this._build();
    for (const d of PARAMS) this._apply(d.id, this.values[d.id], 0);
    this._updateReverb(true);
    this._updateDelayTimes(0);
    if (ctx.state !== 'running') await ctx.resume();
    this.emit('started');
  }

  // ---------- グラフ構築 ----------
  _build() {
    const ctx = this.ctx;
    const mono = { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
    const stereo = { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
    const gain = (v = 1, o = {}) => new GainNode(ctx, { gain: v, ...o });
    const bq = (type, frequency, Q = 1, g = 0, o = {}) => new BiquadFilterNode(ctx, { type, frequency, Q, gain: g, ...o });
    const delay = (t, max = 2, o = {}) => new DelayNode(ctx, { delayTime: t, maxDelayTime: max, ...o });
    const wk = (name, stat, ch = 1, extra = {}) => {
      const n = new AudioWorkletNode(ctx, name, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [ch], ...(ch === 1 ? mono : stereo), ...extra,
      });
      if (stat) n.port.onmessage = (e) => { this.stats[stat] = e.data; };
      return n;
    };
    const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
    const n = {};
    this.n = n;

    // ===== ボーカル =====
    n.micSplit = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    n.selL = gain(1); n.selR = gain(0);
    n.micMono = gain(1, mono);
    n.micSplit.connect(n.selL, 0); n.micSplit.connect(n.selR, 1);
    n.selL.connect(n.micMono); n.selR.connect(n.micMono);
    n.inTrim = gain(1, mono);
    n.meterIn = wk('ul-meter', 'vocalIn', 1);
    n.hpf = bq('highpass', 90, BW, 0, mono);
    n.gate = wk('ul-expander', 'gate');
    n.c1 = wk('ul-compressor', 'c1');
    n.eqLo = bq('lowshelf', 120, 1, 0, mono);
    n.eqM1 = bq('peaking', 350, 1.2, -2.5, mono);
    n.eqM2 = bq('peaking', 3200, 0.9, 2, mono);
    n.eqHi = bq('highshelf', 11000, 1, 2.5, mono);
    n.ds = wk('ul-deesser', 'ds');
    n.sat = wk('ul-saturator', null);
    n.c2 = wk('ul-compressor', 'c2');
    n.rider = new AudioWorkletNode(ctx, 'ul-rider', {
      numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], ...mono,
    });
    n.rider.port.onmessage = (e) => { this.stats.rider = e.data; };
    n.vFader = gain(1, mono);
    n.vOut = gain(1, mono);
    chain(n.micMono, n.inTrim, n.meterIn, n.hpf, n.gate, n.c1, n.eqLo, n.eqM1, n.eqM2, n.eqHi, n.ds, n.sat, n.c2);
    n.c2.connect(n.rider, 0, 0);
    n.rider.connect(n.vFader);
    n.vFader.connect(n.vOut);
    n.vPan = new StereoPannerNode(ctx, { pan: 0 });
    n.vOut.connect(n.vPan);
    n.meterVocal = wk('ul-meter', 'vocal', 1);
    n.vOut.connect(n.meterVocal);
    n.sink = gain(0); // メーター等の出力を引っ張るための無音シンク
    n.meterVocal.connect(n.sink);

    n.masterSum = gain(1, stereo);
    n.fxBus = gain(1, stereo);
    n.vPan.connect(n.masterSum);

    // ===== リバーブ（2台のコンボリューションをクロスフェードしてIR切替時のクリックを防ぐ）=====
    n.revSend = gain(0, mono);
    n.revPre = delay(0.03, 0.5, mono);
    n.revHP = bq('highpass', 300, BW, 0, mono);
    n.revLP = bq('lowpass', 9000, BW, 0, mono);
    n.convA = new ConvolverNode(ctx); n.convB = new ConvolverNode(ctx);
    n.convGA = gain(1); n.convGB = gain(0);
    n.revReturn = gain(1, stereo);
    n.vOut.connect(n.revSend);
    chain(n.revSend, n.revPre, n.revHP, n.revLP);
    n.revLP.connect(n.convA); n.revLP.connect(n.convB);
    n.convA.connect(n.convGA); n.convB.connect(n.convGB);
    n.convGA.connect(n.revReturn); n.convGB.connect(n.revReturn);
    n.revReturn.connect(n.fxBus);

    // ===== ディレイ（ピンポン）＋ オート・スロー =====
    n.dlySend = gain(0, mono);
    n.dA = delay(0.375, 4, mono);
    n.capture = delay(CAPTURE, 1, mono);
    n.throwVCA = gain(0, mono);
    n.revThrowVCA = gain(0, mono);
    n.dB = delay(0.025, 4, mono);
    n.dTap = gain(1, mono);
    n.dHP = bq('highpass', 350, BW, 0, mono);
    n.dLP = bq('lowpass', 5000, BW, 0, mono);
    n.dR = delay(0.375, 4, mono); n.dL = delay(0.375, 4, mono);
    n.loopLP = bq('lowpass', 5000, BW, 0, mono);
    n.fbR = gain(0.28, mono); n.fbL = gain(0.28, mono);
    n.dMerge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    n.dlyReturn = gain(1, stereo);
    n.vOut.connect(n.dlySend); chain(n.dlySend, n.dA, n.dTap);
    n.vOut.connect(n.capture); chain(n.capture, n.throwVCA, n.dB, n.dTap);
    n.capture.connect(n.revThrowVCA); n.revThrowVCA.connect(n.revPre);
    chain(n.dTap, n.dHP, n.dLP);
    n.dLP.connect(n.dMerge, 0, 0);
    chain(n.dLP, n.dR, n.loopLP, n.fbR);
    n.fbR.connect(n.dMerge, 0, 1);
    chain(n.fbR, n.dL, n.fbL);
    n.fbL.connect(n.dMerge, 0, 0);
    n.fbL.connect(n.dR);
    n.dMerge.connect(n.dlyReturn); n.dlyReturn.connect(n.fxBus);

    n.throwDet = wk('ul-throw', 'throw');
    n.vOut.connect(n.throwDet);
    n.manualThrow = new ConstantSourceNode(ctx, { offset: 0 });
    n.manualThrow.start();
    n.throwAmt = gain(0, mono); n.throwRevAmt = gain(0, mono);
    n.throwDet.connect(n.throwAmt); n.manualThrow.connect(n.throwAmt);
    n.throwDet.connect(n.throwRevAmt); n.manualThrow.connect(n.throwRevAmt);
    n.throwAmt.connect(n.throwVCA.gain);
    n.throwRevAmt.connect(n.revThrowVCA.gain);

    // ===== ダブラー =====
    n.dblSend = gain(0, mono);
    n.dblHP = bq('highpass', 200, BW, 0, mono);
    n.dbL = delay(0.013, 0.1, mono); n.dbR = delay(0.021, 0.1, mono);
    n.lfo1 = new OscillatorNode(ctx, { frequency: 0.23 }); n.lfo2 = new OscillatorNode(ctx, { frequency: 0.31 });
    n.lfoG1 = gain(0.0015); n.lfoG2 = gain(0.0015);
    n.lfo1.connect(n.lfoG1).connect(n.dbL.delayTime); n.lfo2.connect(n.lfoG2).connect(n.dbR.delayTime);
    n.lfo1.start(); n.lfo2.start();
    n.dblMerge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    n.vOut.connect(n.dblSend); chain(n.dblSend, n.dblHP);
    n.dblHP.connect(n.dbL); n.dblHP.connect(n.dbR);
    n.dbL.connect(n.dblMerge, 0, 0); n.dbR.connect(n.dblMerge, 0, 1);
    n.dblMerge.connect(n.fxBus);
    n.fxBus.connect(n.masterSum);

    // ===== 伴奏 =====
    n.musicIn = gain(1, stereo);
    n.mTrim = gain(1, stereo);
    n.autogain = wk('ul-autogain', 'autogain', 2);
    n.mLowcut = bq('highpass', 20, BW, 0, stereo);
    n.mLo = bq('lowshelf', 150, 1, 0, stereo);
    n.mHi = bq('highshelf', 8000, 1, 0, stereo);
    n.mPre = gain(1, stereo);
    chain(n.musicIn, n.mTrim, n.autogain, n.mLowcut, n.mLo, n.mHi, n.mPre);
    n.compDelay = delay(0, 1, stereo);
    n.mFader = gain(1, stereo);
    n.carveEQ = bq('peaking', 2500, 0.8, 0, stereo);
    n.meterMusic = wk('ul-meter', 'music', 2);
    chain(n.mPre, n.compDelay, n.mFader, n.carveEQ, n.meterMusic, n.masterSum);
    n.mFader.connect(n.rider, 0, 1); // ライダーのサイドチェーン
    n.carveDet = wk('ul-carve', 'carve');
    n.vOut.connect(n.carveDet);
    n.carveDet.connect(n.carveEQ.gain);

    // ===== マスター =====
    n.glue = wk('ul-compressor', 'glue', 2);
    n.drive = gain(1, stereo);
    n.limiter = wk('ul-limiter', 'limiter', 2);
    n.meterMaster = wk('ul-meter', 'master', 2, { processorOptions: { loudness: true } });
    n.streamOut = gain(1, stereo);
    n.streamDest = new MediaStreamAudioDestinationNode(ctx, { channelCount: 2 });
    chain(n.masterSum, n.glue, n.drive, n.limiter, n.meterMaster, n.streamOut, n.streamDest);
    const gp = n.glue.parameters;
    gp.get('detector').value = 1; gp.get('attack').value = 10; gp.get('release').value = 150; gp.get('knee').value = 6;

    // ===== モニター =====
    n.monVocal = gain(1, stereo); n.monMusic = gain(1, stereo); n.monFx = gain(1, stereo);
    n.monMix = gain(1, stereo);
    n.vPan.connect(n.monVocal); n.mPre.connect(n.monMusic); n.fxBus.connect(n.monFx);
    n.monVocal.connect(n.monMix); n.monMusic.connect(n.monMix); n.monFx.connect(n.monMix);
    n.selMon = gain(1, stereo); n.selStream = gain(0, stereo);
    n.monLevel = gain(0.5, stereo);
    n.monClip = new WaveShaperNode(ctx, { curve: softClipCurve(), oversample: 'none' });
    n.monMix.connect(n.selMon); n.streamOut.connect(n.selStream);
    n.selMon.connect(n.monLevel); n.selStream.connect(n.monLevel);
    chain(n.monLevel, n.monClip, ctx.destination);
    n.sink.connect(ctx.destination);

    this.streamEl = new Audio();
    this.streamEl.autoplay = true;
    this.streamEl.srcObject = n.streamDest.stream;
    this.streamEl.muted = true; // 配信出力デバイスを選ぶまで鳴らさない
  }

  // ---------- パラメータ ----------
  _p(param, value, ramp) {
    const t = this.ctx.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else param.cancelScheduledValues(t);
    if (!(ramp > 0)) param.setValueAtTime(value, t);
    else param.setTargetAtTime(value, t, ramp / 4);
  }
  _wp(node, name, value, ramp) {
    this._p(node.parameters.get(name), value, ramp);
  }

  set(id, value, ramp = 0.03) {
    const d = PARAM_MAP[id];
    if (!d) return;
    this.values[id] = value;
    if (this.ctx) this._apply(id, value, ramp);
    this.emit('param', { id, value });
  }

  _apply(id, v, r) {
    const n = this.n;
    const V = this.values;
    switch (id) {
      case 'in.trim': return this._p(n.inTrim.gain, dbToLin(v), r);
      case 'in.channel':
        this._p(n.selL.gain, v === 'R' ? 0 : v === 'mix' ? 0.5 : 1, 0.02);
        return this._p(n.selR.gain, v === 'L' ? 0 : v === 'mix' ? 0.5 : 1, 0.02);
      case 'v.hpf': return this._p(n.hpf.frequency, v, r);
      case 'gate.thr': return this._wp(n.gate, 'threshold', v, r);
      case 'gate.range': return this._wp(n.gate, 'range', v, r);
      case 'gate.release': return this._wp(n.gate, 'release', v, r);
      case 'c1.thr': return this._wp(n.c1, 'threshold', v, r);
      case 'c1.ratio': return this._wp(n.c1, 'ratio', v, r);
      case 'c1.attack': return this._wp(n.c1, 'attack', v, r);
      case 'c1.release': return this._wp(n.c1, 'release', v, r);
      case 'c1.makeup': return this._wp(n.c1, 'makeup', v, r);
      case 'eq.lo.f': return this._p(n.eqLo.frequency, v, r);
      case 'eq.lo.g': return this._p(n.eqLo.gain, v, r);
      case 'eq.m1.f': return this._p(n.eqM1.frequency, v, r);
      case 'eq.m1.g': return this._p(n.eqM1.gain, v, r);
      case 'eq.m1.q': return this._p(n.eqM1.Q, v, r);
      case 'eq.m2.f': return this._p(n.eqM2.frequency, v, r);
      case 'eq.m2.g': return this._p(n.eqM2.gain, v, r);
      case 'eq.m2.q': return this._p(n.eqM2.Q, v, r);
      case 'eq.hi.f': return this._p(n.eqHi.frequency, v, r);
      case 'eq.hi.g': return this._p(n.eqHi.gain, v, r);
      case 'ds.freq': return this._wp(n.ds, 'frequency', v, 0);
      case 'ds.thr': return this._wp(n.ds, 'threshold', v, r);
      case 'ds.max': return this._wp(n.ds, 'maxReduction', v, r);
      case 'sat.drive': return this._wp(n.sat, 'drive', v, r);
      case 'sat.mix': return this._wp(n.sat, 'mix', v / 100, r);
      case 'c2.thr': return this._wp(n.c2, 'threshold', v, r);
      case 'c2.ratio': return this._wp(n.c2, 'ratio', v, r);
      case 'c2.attack': return this._wp(n.c2, 'attack', v, r);
      case 'c2.release': return this._wp(n.c2, 'release', v, r);
      case 'c2.makeup': return this._wp(n.c2, 'makeup', v, r);
      case 'rider.on': return this._wp(n.rider, 'enabled', v, 0);
      case 'rider.offset': return this._wp(n.rider, 'offset', v, r);
      case 'rider.range': return this._wp(n.rider, 'range', v, r);
      case 'rider.speed': return this._wp(n.rider, 'speed', v, 0);
      case 'rider.floor': return this._wp(n.rider, 'vocalFloor', v, 0);
      case 'v.fader':
      case 'v.mute': return this._p(n.vFader.gain, V['v.mute'] ? 0 : offDb(V['v.fader']), Math.max(r, 0.02));
      case 'rev.type':
      case 'rev.decay': return this._scheduleReverb();
      case 'rev.pre': return this._p(n.revPre.delayTime, v / 1000, Math.max(r, 0.05));
      case 'rev.send': return this._p(n.revSend.gain, offDb(v), r);
      case 'rev.lowcut': return this._p(n.revHP.frequency, v, r);
      case 'rev.hicut': return this._p(n.revLP.frequency, v, r);
      case 'rev.return': return this._p(n.revReturn.gain, dbToLin(v), r);
      case 'dly.bpm':
      case 'dly.div': return this._updateDelayTimes(r);
      case 'dly.send': return this._p(n.dlySend.gain, offDb(v), r);
      case 'dly.fb':
        this._p(n.fbR.gain, v / 100, r);
        return this._p(n.fbL.gain, v / 100, r);
      case 'dly.lowcut': return this._p(n.dHP.frequency, v, r);
      case 'dly.hicut':
        this._p(n.dLP.frequency, v, r);
        return this._p(n.loopLP.frequency, v, r);
      case 'dly.return': return this._p(n.dlyReturn.gain, dbToLin(v), r);
      case 'throw.on': return this._wp(n.throwDet, 'enabled', v, 0);
      case 'throw.amount': return this._p(n.throwAmt.gain, offDb(v), r);
      case 'throw.rev': return this._p(n.throwRevAmt.gain, offDb(v), r);
      case 'throw.thr': return this._wp(n.throwDet, 'threshold', v, 0);
      case 'throw.minPhrase': return this._wp(n.throwDet, 'minPhrase', v, 0);
      case 'throw.gap': return this._wp(n.throwDet, 'gap', v, 0);
      case 'throw.hold': return this._wp(n.throwDet, 'hold', v, 0);
      case 'dbl.send': return this._p(n.dblSend.gain, offDb(v), r);
      case 'dbl.depth':
        this._p(n.lfoG1.gain, v / 1000, r);
        return this._p(n.lfoG2.gain, v / 1000, r);
      case 'm.trim': return this._p(n.mTrim.gain, dbToLin(v), r);
      case 'm.auto': return this._wp(n.autogain, 'enabled', v, 0);
      case 'm.freeze': return this._wp(n.autogain, 'freeze', v, 0);
      case 'm.target': return this._wp(n.autogain, 'target', v, 0);
      case 'm.lowcut': return this._p(n.mLowcut.frequency, v, r);
      case 'm.lo': return this._p(n.mLo.gain, v, r);
      case 'm.hi': return this._p(n.mHi.gain, v, r);
      case 'm.fader':
      case 'm.mute': return this._p(n.mFader.gain, V['m.mute'] ? 0 : offDb(V['m.fader']), Math.max(r, 0.02));
      case 'carve.depth': return this._wp(n.carveDet, 'depth', v, r);
      case 'carve.freq': return this._p(n.carveEQ.frequency, v, r);
      case 'carve.q': return this._p(n.carveEQ.Q, v, r);
      case 'carve.thr': return this._wp(n.carveDet, 'threshold', v, 0);
      case 'mst.glue.thr': return this._wp(n.glue, 'threshold', v, r);
      case 'mst.glue.ratio': return this._wp(n.glue, 'ratio', v, r);
      case 'mst.drive': return this._p(n.drive.gain, dbToLin(v), r);
      case 'mst.ceiling': return this._wp(n.limiter, 'ceiling', v, 0);
      case 'mst.release': return this._wp(n.limiter, 'release', v, 0);
      case 'sys.comp': return this._p(n.compDelay.delayTime, v / 1000, 0.05);
      case 'mon.source':
        this._p(n.selMon.gain, v === 'stream' ? 0 : 1, 0.05);
        return this._p(n.selStream.gain, v === 'stream' ? 1 : 0, 0.05);
      case 'mon.vocal': return this._p(n.monVocal.gain, offDb(v), r);
      case 'mon.music': return this._p(n.monMusic.gain, offDb(v), r);
      case 'mon.fx': return this._p(n.monFx.gain, offDb(v), r);
      case 'mon.level': return this._p(n.monLevel.gain, offDb(v), r);
      default:
    }
  }

  _updateDelayTimes(r) {
    if (!this.ctx) return;
    const T = noteSeconds(this.values['dly.bpm'], this.values['dly.div']);
    const n = this.n;
    const k = Math.max(1, Math.ceil(CAPTURE / T - 1e-9));
    const rr = Math.max(r, 0.08);
    this._p(n.dA.delayTime, T, rr);
    this._p(n.dB.delayTime, Math.max(0, k * T - CAPTURE), rr);
    this._p(n.dL.delayTime, T, rr);
    this._p(n.dR.delayTime, T, rr);
    this.delaySeconds = T;
  }

  _scheduleReverb() {
    clearTimeout(this._revTimer);
    this._revTimer = setTimeout(() => this._updateReverb(false), 120);
  }

  _updateReverb(initial) {
    const ctx = this.ctx;
    const [L, R] = generateIR({ sampleRate: ctx.sampleRate, decay: this.values['rev.decay'], type: this.values['rev.type'], seed: 7 });
    const buf = ctx.createBuffer(2, L.length, ctx.sampleRate);
    buf.copyToChannel(L, 0);
    buf.copyToChannel(R, 1);
    const n = this.n;
    if (initial) {
      n.convA.buffer = buf;
      this._revActive = 0;
      return;
    }
    const next = this._revActive === 0 ? 1 : 0;
    (next ? n.convB : n.convA).buffer = buf;
    const xf = Math.max(0.3, this.values['sys.xfade'] * 0.5);
    this._p(n.convGA.gain, next ? 0 : 1, xf);
    this._p(n.convGB.gain, next ? 1 : 0, xf);
    this._revActive = next;
  }

  // ---------- 入出力 ----------
  async setMic(deviceId) {
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    if (this.micSrc) this.micSrc.disconnect();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // 歌の音質を壊すブラウザ既定の処理はすべてオフ
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: { ideal: 2 }, sampleRate: 48000, latency: 0,
      },
    });
    this.micStream = stream;
    this.micSrc = this.ctx.createMediaStreamSource(stream);
    this.micSrc.connect(this.n.micSplit);
    const tr = stream.getAudioTracks()[0];
    const s = tr.getSettings();
    this.mic = { label: tr.label, channels: s.channelCount ?? 1, latency: s.latency ?? 0, deviceId: s.deviceId };
    this.emit('io');
    return this.mic;
  }

  _clearMusic() {
    if (this.musicStream) this.musicStream.getTracks().forEach((t) => t.stop());
    this.musicStream = null;
    if (this.musicSrc) this.musicSrc.disconnect();
    this.musicSrc = null;
    if (this.musicEl) { this.musicEl.pause(); URL.revokeObjectURL(this.musicEl.src); }
    this.musicEl = null;
  }

  /** YouTube などのタブ音声を取り込む（Chrome/Edge）。タブ側のスピーカー再生は止める。 */
  async captureTab() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1, width: { ideal: 320 }, height: { ideal: 180 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: true },
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'exclude',
      monitorTypeSurfaces: 'exclude',
    });
    const at = stream.getAudioTracks()[0];
    if (!at) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('音声が共有されていません。共有ダイアログで「タブ」を選び「タブの音声も共有する」をオンにしてください。');
    }
    this._clearMusic();
    this.musicStream = stream;
    this.musicSrc = this.ctx.createMediaStreamSource(new MediaStream([at]));
    this.musicSrc.connect(this.n.musicIn);
    const vt = stream.getVideoTracks()[0];
    const label = vt?.label || at.label || 'タブ音声';
    at.addEventListener('ended', () => { this.music = { kind: null, label: '共有が終了しました' }; this.emit('io'); });
    this.music = { kind: 'tab', label };
    this.relearnMusic();
    this.emit('io');
  }

  async setMusicDevice(deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
    });
    this._clearMusic();
    this.musicStream = stream;
    this.musicSrc = this.ctx.createMediaStreamSource(stream);
    this.musicSrc.connect(this.n.musicIn);
    this.music = { kind: 'device', label: stream.getAudioTracks()[0].label };
    this.relearnMusic();
    this.emit('io');
  }

  loadMusicFile(file) {
    this._clearMusic();
    const el = new Audio();
    el.src = URL.createObjectURL(file);
    el.controls = true;
    this.musicEl = el;
    this.musicSrc = this.ctx.createMediaElementSource(el);
    this.musicSrc.connect(this.n.musicIn);
    this.music = { kind: 'file', label: file.name };
    this.relearnMusic();
    this.emit('io');
    return el;
  }

  relearnMusic() {
    this.n?.autogain.port.postMessage('relearn');
  }

  async setMonitorSink(id) {
    if (!this.ctx.setSinkId) throw new Error('このブラウザはモニター出力先の変更に対応していません（Chrome/Edge 110 以降が必要）');
    await this.ctx.setSinkId(id || '');
  }

  async setStreamSink(id) {
    const el = this.streamEl;
    if (!id) { el.muted = true; return; }
    if (!el.setSinkId) throw new Error('このブラウザは配信出力先の指定に対応していません');
    await el.setSinkId(id);
    el.muted = false;
    await el.play().catch(() => {});
  }

  /** ブラウザが報告する往復レイテンシの推定（ms） */
  estimateLatencyMs() {
    const c = this.ctx;
    const out = (c.outputLatency || 0) + (c.baseLatency || 0);
    return Math.round((out + (this.mic.latency || 0)) * 1000);
  }

  // ---------- 操作 ----------
  throwManual(on) {
    if (!this.ctx) return;
    this._p(this.n.manualThrow.offset, on ? 1 : 0, on ? 0.02 : 0.4);
  }

  panic(on) {
    this.panicked = on;
    this._p(this.n.streamOut.gain, on ? 0 : 1, 0.05);
    this._p(this.n.monLevel.gain, on ? 0 : offDb(this.values['mon.level']), 0.05);
    this.emit('panic', on);
  }

  resetLoudness() {
    this.n.meterMaster.port.postMessage('reset');
  }

  startRecording() {
    const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    const rec = new MediaRecorder(this.n.streamDest.stream, { mimeType, audioBitsPerSecond: 320000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType });
      const ext = rec.mimeType.includes('mp4') ? 'm4a' : rec.mimeType.includes('ogg') ? 'ogg' : 'webm';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `utawaku-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };
    rec.start(1000);
    this.recorder = rec;
  }

  stopRecording() {
    this.recorder?.stop();
    this.recorder = null;
  }
}

/** モニター用の耳保護ソフトクリップ（-4.4dBFS までは完全に線形、レイテンシなし） */
function softClipCurve() {
  const N = 4096;
  const c = new Float32Array(N);
  const k = 0.6;
  const w = 0.35;
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = a < k ? x : Math.sign(x) * (k + w * Math.tanh((a - k) / w));
  }
  return c;
}
