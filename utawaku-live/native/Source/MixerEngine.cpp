#include "MixerEngine.h"

namespace ul {

namespace {
constexpr double kCapture = 0.35; // スロー用：語尾を拾うために送りを遅らせる時間(s)
inline float offDb(float db) { return db <= -60.0f ? 0.0f : (float) dbToLin(db); }
inline float softClip(float x) {
    const float a = std::abs(x);
    return a < 0.6f ? x : std::copysign(0.6f + 0.35f * std::tanh((a - 0.6f) / 0.35f), x);
}
inline float peakOf(const float* p, int n) {
    auto r = juce::FloatVectorOperations::findMinAndMax(p, n);
    return juce::jmax(std::abs(r.getStart()), std::abs(r.getEnd()));
}
} // namespace

MixerEngine::MixerEngine() {
    for (auto& p : paramDefs()) {
        target[(size_t) p.index].store(p.def);
        ramp[(size_t) p.index].store(0);
        current[(size_t) p.index] = p.def;
    }
    const char* names[] = { "vocal", "auxA", "auxB", "music", "master" };
    for (int i = 0; i < kNumChains; ++i) chains[(size_t) i] = std::make_unique<PluginChain>(names[i]);
    formatManager.registerBasicFormats();
    readAheadThread.startThread();
    browserBridge.setTargetLatencyMs(40);
    secondaryInBridge.setTargetLatencyMs(30);
    secondaryOutBridge.setTargetLatencyMs(30);
    startTimerHz(30);
}

MixerEngine::~MixerEngine() {
    stopTimer();
    stopRecording();
    transport.setSource(nullptr);
    readAheadThread.stopThread(2000);
    for (auto& c : chains) c->release();
}

void MixerEngine::setParam(int id, float value, float rampSeconds) {
    if (id < 0 || id >= kNumParams) return;
    const auto& d = def(id);
    if (d.type == PType::Float) value = juce::jlimit(d.min, d.max, value);
    ramp[(size_t) id].store(rampSeconds);
    target[(size_t) id].store(value);
}

bool MixerEngine::loadMusicFile(const juce::File& f) {
    std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(f));
    if (reader == nullptr) return false;
    const double sr = reader->sampleRate;
    auto src = std::make_unique<juce::AudioFormatReaderSource>(reader.release(), true);
    transport.stop();
    transport.setSource(src.get(), 32768, &readAheadThread, sr, 2);
    readerSource = std::move(src);
    musicFileName = f.getFileName();
    musicSource.store((int) MusicSource::file);
    agRelearn.store(true);
    return true;
}

bool MixerEngine::startRecording(const juce::File& f) {
    stopRecording();
    f.getParentDirectory().createDirectory();
    std::unique_ptr<juce::OutputStream> stream = f.createOutputStream();
    if (stream == nullptr) return false;
    juce::WavAudioFormat wav;
    auto w = wav.createWriterFor(stream, juce::AudioFormatWriterOptions().withSampleRate(sampleRate).withNumChannels(2).withBitsPerSample(24));
    if (w == nullptr) return false;
    writerThread.startThread();
    {
        const juce::ScopedLock sl(writerLock);
        writer = std::make_unique<juce::AudioFormatWriter::ThreadedWriter>(w.release(), writerThread, 32768);
        recordingFile = f;
        writerActive.store(true);
    }
    return true;
}

void MixerEngine::stopRecording() {
    std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> old;
    {
        const juce::ScopedLock sl(writerLock);
        writerActive.store(false);
        old = std::move(writer);
    }
    old.reset(); // 残りを書き出して閉じる
}

// ------------------------------------------------------------------ 準備
void MixerEngine::prepare(double sr, int maxBlock) {
    const juce::ScopedLock sl(prepareLock);
    prepared.store(false);
    sampleRate = sr;
    blockSize = juce::jmax(16, maxBlock);
    const auto S = [sr](double sec) { return (int) std::ceil(sec * sr); };

    gate.init(sr); c1.init(sr); c2.init(sr); ds.init(sr); rider.init(sr);
    for (auto* f : { &hpf, &eqLo, &eqM1, &eqM2, &eqHi, &revHP, &revLP, &dHP, &dLP, &loopLP, &dblHP }) { f->freq = -1; f->reset(); }
    for (auto* arr : { &mLowcutF, &mLoF, &mHiF, &carveF })
        for (auto& f : *arr) { f.freq = -1; f.reset(); }
    revPreDelay.init(S(0.2)); capture.init(S(0.6));
    for (auto* d : { &dA, &dB, &dL, &dR }) d->init(S(4.5));
    dblL.init(S(0.1)); dblR.init(S(0.1));
    for (auto& d : compDelay) d.init(S(1.8));
    throwDet.init(sr);
    carve.init(sr);
    autogain.init(sr, 2);
    glue.init(sr);
    limiter.init(sr, 2, 3);
    loud.init(sr, 2);

    for (auto* b : { &vMono, &vPre }) b->setSize(1, blockSize);
    for (auto* b : { &vSt, &mBuf, &mPre, &mPost, &revBuf, &dlyBuf, &dblBuf, &fx, &master, &monitor, &fileBuf }) b->setSize(2, blockSize);

    conv.prepare({ sr, (juce::uint32) blockSize, 2 });
    conv.reset();
    irDecay = irType = -1;
    updateReverbNow();

    for (auto& c : chains) c->prepare(sr, blockSize);
    transport.prepareToPlay(blockSize, sr);
    browserBridge.setConsumerRate(sr);
    secondaryInBridge.setConsumerRate(sr);
    secondaryOutBridge.setProducerRate(sr);
    load.reset(sr, blockSize);
    firstBlock = true;
    prepared.store(true);
}

void MixerEngine::audioDeviceAboutToStart(juce::AudioIODevice* d) {
    prepare(d->getCurrentSampleRate(), d->getCurrentBufferSizeSamples());
}

void MixerEngine::audioDeviceStopped() {
    prepared.store(false);
    transport.releaseResources();
}

void MixerEngine::audioDeviceIOCallbackWithContext(const float* const* in, int numIn, float* const* out, int numOut, int n,
                                                   const juce::AudioIODeviceCallbackContext&) {
    juce::AudioProcessLoadMeasurer::ScopedTimer t(load, n);
    process(in, numIn, out, numOut, n);
    meters.cpu.store((float) load.getLoadAsProportion());
}

void MixerEngine::process(const float* const* in, int numIn, float* const* out, int numOut, int n) {
    const juce::ScopedTryLock sl(prepareLock);
    if (!sl.isLocked() || !prepared.load()) {
        for (int c = 0; c < numOut; ++c)
            if (out[c]) juce::FloatVectorOperations::clear(out[c], n);
        return;
    }
    constexpr int kMaxCh = 64;
    const float* inPtr[kMaxCh];
    float* outPtr[kMaxCh];
    numIn = juce::jmin(numIn, kMaxCh);
    numOut = juce::jmin(numOut, kMaxCh);
    for (int done = 0; done < n;) {
        const int chunk = juce::jmin(blockSize, n - done);
        for (int c = 0; c < numIn; ++c) inPtr[c] = in[c] ? in[c] + done : nullptr;
        for (int c = 0; c < numOut; ++c) outPtr[c] = out[c] ? out[c] + done : nullptr;
        processChunk(inPtr, numIn, outPtr, numOut, chunk);
        done += chunk;
    }
}

void MixerEngine::updateParams(int n) {
    for (auto& p : paramDefs()) {
        const size_t i = (size_t) p.index;
        const float t = target[i].load();
        if (p.type != PType::Float || firstBlock) { current[i] = t; continue; }
        const float r = ramp[i].load();
        if (r <= 0.0005f) { current[i] = t; continue; }
        const float a = 1.0f - std::exp(-(float) n / (float) (sampleRate * juce::jmax(0.0005f, r / 4.0f)));
        current[i] += (t - current[i]) * a;
        if (std::abs(t - current[i]) < 1e-4f * (1.0f + std::abs(t))) current[i] = t;
    }
    const bool j = firstBlock;
    gTrim.set((float) dbToLin(cur(inTrim)), j);
    gFader.set(cur(vMute) > 0.5f ? 0.0f : offDb(cur(vFader)), j);
    gRevSend.set(offDb(cur(revSend)), j);
    gRevRet.set((float) dbToLin(cur(revReturn)), j);
    gDlySend.set(offDb(cur(dlySend)), j);
    gDlyRet.set((float) dbToLin(cur(dlyReturn)), j);
    gThrowAmt.set(offDb(cur(throwAmount)), j);
    gThrowRev.set(offDb(cur(throwRev)), j);
    gDblSend.set(offDb(cur(dblSend)), j);
    gMTrim.set((float) dbToLin(cur(mTrim)), j);
    gMFader.set(cur(mMute) > 0.5f ? 0.0f : offDb(cur(mFader)), j);
    gDrive.set((float) dbToLin(cur(mstDrive)), j);
    gMonVocal.set(offDb(cur(monVocal)), j);
    gMonMusic.set(offDb(cur(monMusic)), j);
    gMonFx.set(offDb(cur(monFx)), j);
    gMonLevel.set(panicked.load() ? 0.0f : offDb(cur(monLevel)), j);
    gStream.set(panicked.load() ? 0.0f : 1.0f, j);
    // 手動スローは押した瞬間に開き、離したらゆっくり閉じる
    const float mt = manualThrow.load();
    gManual.set(mt > gManual.next ? mt : gManual.next + (mt - gManual.next) * (1.0f - std::exp(-(float) n / (float) (sampleRate * 0.15))), j);
}

// ------------------------------------------------------------------ 本体
void MixerEngine::processChunk(const float* const* in, int numIn, float* const* out, int numOut, int n) {
    updateParams(n);
    const double fs = sampleRate;

    if (loudReset.exchange(false)) loud.reset();
    if (agRelearn.exchange(false)) autogain.relearn();

    // ================= ボーカル（モノ・内蔵チェーン）
    const int ch = (int) cur(inChannel);
    const bool sum = cur(inSum) > 0.5f;
    const float* micA = ch < numIn ? in[ch] : nullptr;
    const float* micB = sum && ch + 1 < numIn ? in[ch + 1] : nullptr;
    float* v = vMono.getWritePointer(0);
    float* vp = vPre.getWritePointer(0);
    float* vL = vSt.getWritePointer(0);
    float* vR = vSt.getWritePointer(1);

    hpf.update(FilterType::highpass, fs, cur(vHpf), 0.7071, 0);
    gate.set({ cur(gateThr), cur(gateRange), 3, 1, 80, cur(gateRelease) });
    c1.set({ cur(c1Thr), cur(c1Ratio), 6, cur(c1Attack), cur(c1Release), cur(c1Makeup), false });
    eqLo.update(FilterType::lowshelf, fs, cur(eqLoF), 0.7071, cur(eqLoG));
    eqM1.update(FilterType::peaking, fs, cur(eqM1F), cur(eqM1Q), cur(eqM1G));
    eqM2.update(FilterType::peaking, fs, cur(eqM2F), cur(eqM2Q), cur(eqM2G));
    eqHi.update(FilterType::highshelf, fs, cur(eqHiF), 0.7071, cur(eqHiG));
    ds.set(cur(dsFreq), cur(dsThr), 4, cur(dsMax));
    sat.set(cur(satDrive), cur(satMix) / 100.0);
    c2.set({ cur(c2Thr), cur(c2Ratio), 6, cur(c2Attack), cur(c2Release), cur(c2Makeup), true });
    const bool useC1 = cur(c1On) > 0.5f, useEq = cur(eqOn) > 0.5f, useDs = cur(dsOn) > 0.5f, useSat = cur(satMix) > 0.05f, useC2 = cur(c2On) > 0.5f;

    float inPk = 0, grG = 0, grA = 0, grD = 0, grB = 0;
    for (int i = 0; i < n; ++i) {
        float x = micA ? micA[i] : 0.0f;
        if (micB) x = 0.5f * (x + micB[i]);
        x *= gTrim.at(i, n);
        inPk = juce::jmax(inPk, std::abs(x));
        double y = hpf.process(x);
        y *= gate.gain(y);
        grG = juce::jmax(grG, (float) gate.gr);
        if (useC1) { y *= c1.gain(std::abs(y)); grA = juce::jmax(grA, (float) c1.gr); }
        if (useEq) y = eqHi.process(eqM2.process(eqM1.process(eqLo.process(y))));
        if (useDs) { y = ds.process(y); grD = juce::jmax(grD, (float) ds.gr); }
        if (useSat) y = sat.process(y);
        if (useC2) { y *= c2.gain(std::abs(y)); grB = juce::jmax(grB, (float) c2.gr); }
        v[i] = vp[i] = vL[i] = vR[i] = (float) y;
    }
    Meters::maxInto(meters.vocalIn, inPk);
    Meters::maxInto(meters.grGate, grG);
    Meters::maxInto(meters.grC1, grA);
    Meters::maxInto(meters.grDs, grD);
    Meters::maxInto(meters.grC2, grB);

    // ================= ボーカル・インサート（VST）
    chains[chainVocal]->process(vL, vR, n);

    // ================= 伴奏
    float* mL = mBuf.getWritePointer(0);
    float* mR = mBuf.getWritePointer(1);
    switch ((MusicSource) musicSource.load()) {
        case MusicSource::browser: browserBridge.pull(mL, mR, n); break;
        case MusicSource::secondaryDevice: secondaryInBridge.pull(mL, mR, n); break;
        case MusicSource::deviceInputs: {
            const int mc = musicInputCh.load();
            const float* a = mc < numIn ? in[mc] : nullptr;
            const float* b = mc + 1 < numIn ? in[mc + 1] : a;
            if (a) std::copy(a, a + n, mL); else std::fill(mL, mL + n, 0.0f);
            if (b) std::copy(b, b + n, mR); else std::copy(mL, mL + n, mR);
            break;
        }
        case MusicSource::file: {
            juce::AudioBuffer<float> fb(fileBuf.getArrayOfWritePointers(), 2, n);
            transport.getNextAudioBlock(juce::AudioSourceChannelInfo(&fb, 0, n));
            std::copy(fb.getReadPointer(0), fb.getReadPointer(0) + n, mL);
            std::copy(fb.getReadPointer(1), fb.getReadPointer(1) + n, mR);
            break;
        }
        case MusicSource::none:
        default: std::fill(mL, mL + n, 0.0f); std::fill(mR, mR + n, 0.0f);
    }
    autogain.set(cur(mTarget), 12, 1, cur(mAuto) > 0.5f, cur(mFreeze) > 0.5f);
    for (int c = 0; c < 2; ++c) {
        mLowcutF[(size_t) c].update(FilterType::highpass, fs, cur(mLowcut), 0.7071, 0);
        mLoF[(size_t) c].update(FilterType::lowshelf, fs, 150, 0.7071, cur(mLo));
        mHiF[(size_t) c].update(FilterType::highshelf, fs, 8000, 0.7071, cur(mHi));
    }
    for (int i = 0; i < n; ++i) { const float g = gMTrim.at(i, n); mL[i] *= g; mR[i] *= g; }
    {
        const float* mp[2] = { mL, mR };
        for (int i = 0; i < n; ++i) {
            const float g = (float) autogain.frame(mp, i);
            mL[i] = (float) mHiF[0].process(mLoF[0].process(mLowcutF[0].process(mL[i] * g)));
            mR[i] = (float) mHiF[1].process(mLoF[1].process(mLowcutF[1].process(mR[i] * g)));
        }
    }
    meters.agGain.store((float) autogain.gDb);
    meters.agLufs.store((float) autogain.loudness());
    chains[chainMusic]->process(mL, mR, n);
    mPre.copyFrom(0, 0, mBuf, 0, 0, n);
    mPre.copyFrom(1, 0, mBuf, 1, 0, n);

    // 遅延補正：手動分 ＋ ボーカルVSTのレイテンシ
    float* pL = mPost.getWritePointer(0);
    float* pR = mPost.getWritePointer(1);
    const double compTarget = cur(sysComp) / 1000.0 * fs + chains[chainVocal]->latencySamples();
    const double compCoef = 1.0 - std::exp(-1.0 / (0.05 * fs));
    if (firstBlock) compDelaySmoothed = compTarget;
    for (int i = 0; i < n; ++i) {
        compDelaySmoothed += (compTarget - compDelaySmoothed) * compCoef;
        compDelay[0].write(mL[i]);
        compDelay[1].write(mR[i]);
        const float g = gMFader.at(i, n);
        pL[i] = compDelay[0].read(compDelaySmoothed) * g;
        pR[i] = compDelay[1].read(compDelaySmoothed) * g;
    }

    // ================= ライダー → フェーダー
    rider.set(cur(riderOffset), cur(riderRange), cur(riderSpeed), cur(riderFloor), cur(riderOn) > 0.5f);
    for (int i = 0; i < n; ++i) {
        const double g = rider.gain(0.5 * (vL[i] + vR[i]), 0.5 * (pL[i] + pR[i])) * gFader.at(i, n);
        vL[i] = (float) (vL[i] * g);
        vR[i] = (float) (vR[i] * g);
        v[i] = 0.5f * (vL[i] + vR[i]); // 以降のセンドはポストフェーダーのモノ
    }
    meters.riderDb.store((float) rider.gDb);
    Meters::maxInto(meters.vocalOut, juce::jmax(peakOf(vL, n), peakOf(vR, n)));

    // ================= ボーカル帯域カーブ
    carve.set(cur(carveThr), cur(carveDepth));
    for (int i = 0; i < n; ++i) {
        const double c = carve.process(v[i]);
        if ((i & 15) == 0)
            for (auto& f : carveF) f.update(FilterType::peaking, fs, cur(carveFreq), cur(carveQ), std::round(c * 20.0) / 20.0);
        pL[i] = (float) carveF[0].process(pL[i]);
        pR[i] = (float) carveF[1].process(pR[i]);
    }
    meters.carveDb.store((float) carve.out);
    Meters::maxInto(meters.musicL, peakOf(pL, n));
    Meters::maxInto(meters.musicR, peakOf(pR, n));

    // ================= FX（リバーブ・ディレイ・スロー・ダブラー）
    throwDet.set(cur(throwThr), cur(throwGap), cur(throwMinPhrase), cur(throwHold), 500, cur(throwOn) > 0.5f);
    revHP.update(FilterType::highpass, fs, cur(revLowcut), 0.7071, 0);
    revLP.update(FilterType::lowpass, fs, cur(revHicut), 0.7071, 0);
    dHP.update(FilterType::highpass, fs, cur(dlyLowcut), 0.7071, 0);
    dLP.update(FilterType::lowpass, fs, cur(dlyHicut), 0.7071, 0);
    loopLP.update(FilterType::lowpass, fs, cur(dlyHicut), 0.7071, 0);
    dblHP.update(FilterType::highpass, fs, 200, 0.7071, 0);
    const double T = noteSeconds(cur(dlyBpm), (int) cur(dlyDiv));
    delaySeconds.store(T);
    const double k = std::max(1.0, std::ceil(kCapture / T - 1e-9));
    const double fb = cur(dlyFb) / 100.0;
    const double capS = kCapture * fs;
    const double revPreTarget = cur(revPre) / 1000.0 * fs;
    const double smoothC = 1.0 - std::exp(-1.0 / (0.08 * fs));
    if (firstBlock) { delayTSmoothed = T; revPreSmoothed = revPreTarget; }
    const bool dlyInt = cur(dlyBuiltin) > 0.5f;
    const double depth = cur(dblDepth) / 1000.0 * fs;
    const double lfoInc1 = 2 * kPi * 0.23 / fs, lfoInc2 = 2 * kPi * 0.31 / fs;
    float* rL = revBuf.getWritePointer(0); float* rR = revBuf.getWritePointer(1);
    float* dlL = dlyBuf.getWritePointer(0); float* dlR = dlyBuf.getWritePointer(1);
    float* dbL = dblBuf.getWritePointer(0); float* dbR = dblBuf.getWritePointer(1);
    float thrPk = 0;
    for (int i = 0; i < n; ++i) {
        delayTSmoothed += (T - delayTSmoothed) * smoothC;
        revPreSmoothed += (revPreTarget - revPreSmoothed) * smoothC;
        const float x = v[i];
        const float total = (float) throwDet.process(x) + gManual.at(i, n);
        thrPk = juce::jmax(thrPk, total);
        capture.write(x);
        const float capd = capture.read(capS);
        // リバーブへの送り（常時＋スロー）
        revPreDelay.write(x * gRevSend.at(i, n) + capd * total * gThrowRev.at(i, n));
        const float r = (float) revLP.process(revHP.process(revPreDelay.read(revPreSmoothed)));
        rL[i] = rR[i] = r;
        // ディレイ（ピンポン）
        const float normal = x * gDlySend.at(i, n);
        const float thrIn = capd * total * gThrowAmt.at(i, n);
        if (dlyInt) {
            const double Ts = delayTSmoothed * fs;
            dA.write(normal);
            dB.write(thrIn);
            const double tap = dA.read(Ts) + dB.read(std::max(0.0, k * Ts - capS));
            const double first = dLP.process(dHP.process(tap));
            const double rOut = dR.read(Ts), lOut = dL.read(Ts);
            const double rr = loopLP.process(rOut) * fb, ll = lOut * fb;
            dR.write((float) (first + ll));
            dL.write((float) rr);
            dlL[i] = (float) (first + ll);
            dlR[i] = (float) rr;
        } else {
            dlL[i] = dlR[i] = normal + thrIn; // 送り信号をそのまま AUX B の VST へ
        }
        // ダブラー
        const float d = (float) dblHP.process(x * gDblSend.at(i, n));
        dblL.write(d);
        dblR.write(d);
        lfo1 += lfoInc1; lfo2 += lfoInc2;
        if (lfo1 > 2 * kPi) lfo1 -= 2 * kPi;
        if (lfo2 > 2 * kPi) lfo2 -= 2 * kPi;
        dbL[i] = dblL.read(0.013 * fs + depth * std::sin(lfo1));
        dbR[i] = dblR.read(0.021 * fs + depth * std::sin(lfo2));
    }
    meters.throwAmt.store(thrPk);
    meters.throwTriggers.store(throwDet.triggers);

    if (cur(revBuiltin) > 0.5f) {
        juce::dsp::AudioBlock<float> blk(revBuf.getArrayOfWritePointers(), 2, (size_t) n);
        conv.process(juce::dsp::ProcessContextReplacing<float>(blk));
    }
    chains[chainAuxA]->process(rL, rR, n);
    chains[chainAuxB]->process(dlL, dlR, n);
    float* fL = fx.getWritePointer(0);
    float* fR = fx.getWritePointer(1);
    for (int i = 0; i < n; ++i) {
        const float ra = gRevRet.at(i, n), da = gDlyRet.at(i, n);
        fL[i] = rL[i] * ra + dlL[i] * da + dbL[i];
        fR[i] = rR[i] * ra + dlR[i] * da + dbR[i];
    }

    // ================= マスター
    float* sL = master.getWritePointer(0);
    float* sR = master.getWritePointer(1);
    for (int i = 0; i < n; ++i) {
        sL[i] = vL[i] + pL[i] + fL[i];
        sR[i] = vR[i] + pR[i] + fR[i];
    }
    chains[chainMaster]->process(sL, sR, n);
    glue.set({ cur(mstGlueThr), cur(mstGlueRatio), 6, 10, 150, 0, true });
    float grGl = 0;
    for (int i = 0; i < n; ++i) {
        const float g = (float) glue.gain(juce::jmax(std::abs(sL[i]), std::abs(sR[i]))) * gDrive.at(i, n);
        grGl = juce::jmax(grGl, (float) glue.gr);
        sL[i] *= g;
        sR[i] *= g;
    }
    limiter.set(cur(mstCeiling), cur(mstRelease));
    float* lim[2] = { sL, sR };
    limiter.process(lim, n);
    Meters::maxInto(meters.grGlue, grGl);
    Meters::maxInto(meters.grLim, (float) -linToDb(limiter.gainNow));
    const float* lp[2] = { sL, sR };
    loud.push(lp, n);
    meters.lufsM.store((float) loud.momentary());
    meters.lufsS.store((float) loud.shortTerm());
    if ((loudCounter += n) >= (int) (fs * 0.5)) { loudCounter = 0; meters.lufsI.store((float) loud.integrated()); }
    const float mPkL = peakOf(sL, n), mPkR = peakOf(sR, n);
    Meters::maxInto(meters.masterL, mPkL);
    Meters::maxInto(meters.masterR, mPkR);
    if (mPkL >= 0.999f || mPkR >= 0.999f) meters.clip.store(true);
    for (int i = 0; i < n; ++i) { const float g = gStream.at(i, n); sL[i] *= g; sR[i] *= g; }

    // ================= モニター
    float* oL = monitor.getWritePointer(0);
    float* oR = monitor.getWritePointer(1);
    if (cur(monSource) > 0.5f) {
        std::copy(sL, sL + n, oL);
        std::copy(sR, sR + n, oR);
    } else {
        const bool pre = cur(monVTap) < 0.5f;
        const float* mpL = mPre.getReadPointer(0);
        const float* mpR = mPre.getReadPointer(1);
        for (int i = 0; i < n; ++i) {
            const float gv = gMonVocal.at(i, n), gm = gMonMusic.at(i, n), gf = gMonFx.at(i, n);
            const float tl = pre ? vp[i] * gFader.at(i, n) : vL[i];
            const float tr = pre ? vp[i] * gFader.at(i, n) : vR[i];
            oL[i] = tl * gv + mpL[i] * gm + fL[i] * gf;
            oR[i] = tr * gv + mpR[i] * gm + fR[i] * gf;
        }
    }
    float monPk = 0;
    for (int i = 0; i < n; ++i) {
        const float g = gMonLevel.at(i, n);
        oL[i] = softClip(oL[i] * g);
        oR[i] = softClip(oR[i] * g);
        monPk = juce::jmax(monPk, std::abs(oL[i]), std::abs(oR[i]));
    }
    Meters::maxInto(meters.monitor, monPk);

    // ================= 出力
    for (int c = 0; c < numOut; ++c)
        if (out[c]) juce::FloatVectorOperations::clear(out[c], n);
    const int mo = monitorOutCh.load();
    if (mo >= 0 && mo < numOut && out[mo]) std::copy(oL, oL + n, out[mo]);
    if (mo >= 0 && mo + 1 < numOut && out[mo + 1]) std::copy(oR, oR + n, out[mo + 1]);
    const int so = streamOutCh.load();
    if (so == kOutSecondary) secondaryOutBridge.push(sL, sR, n);
    else if (so >= 0) {
        if (so < numOut && out[so]) juce::FloatVectorOperations::add(out[so], sL, n);
        if (so + 1 < numOut && out[so + 1]) juce::FloatVectorOperations::add(out[so + 1], sR, n);
    }

    // ================= 録音（配信ミックス）
    if (writerActive.load()) {
        const juce::ScopedTryLock wl(writerLock);
        if (wl.isLocked() && writer) {
            const float* wp[2] = { sL, sR };
            writer->write(wp, n);
        }
    }
    firstBlock = false;
}

// ------------------------------------------------------------------ メッセージスレッド
void MixerEngine::updateReverbNow() {
    irDecay = target[revDecay].load();
    irType = target[revType].load();
    auto ir = generateIR(sampleRate, irDecay, (ReverbType) juce::jlimit(0, 3, (int) irType));
    juce::AudioBuffer<float> buf(2, (int) ir[0].size());
    buf.copyFrom(0, 0, ir[0].data(), (int) ir[0].size());
    buf.copyFrom(1, 0, ir[1].data(), (int) ir[1].size());
    conv.loadImpulseResponse(std::move(buf), sampleRate, juce::dsp::Convolution::Stereo::yes, juce::dsp::Convolution::Trim::no,
                             juce::dsp::Convolution::Normalise::yes);
}

void MixerEngine::timerCallback() {
    for (auto& c : chains) c->updateLatency();
    const float d = target[revDecay].load(), t = target[revType].load();
    if (d != irDecay || t != irType) {
        const auto now = juce::Time::getMillisecondCounter();
        if (irChangedAt == 0) irChangedAt = now;
        else if (now - irChangedAt > 150 && prepared.load()) { irChangedAt = 0; updateReverbNow(); }
    }
}

} // namespace ul
