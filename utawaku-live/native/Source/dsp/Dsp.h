// UTAWAKU LIVE — DSP コア（JUCE 非依存のヘッダオンリー C++17）
// Web 版 src/dsp/*.js と同じアルゴリズム。Tests/DspTests.cpp でテストする。
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace ul {

constexpr double kPi = 3.14159265358979323846;

inline double dbToLin(double db) { return std::pow(10.0, db / 20.0); }
inline double linToDb(double x) { return x > 1e-10 ? 20.0 * std::log10(x) : -200.0; }
inline double powToDb(double p) { return p > 1e-20 ? 10.0 * std::log10(p) : -200.0; }
inline double clampd(double x, double lo, double hi) { return x < lo ? lo : (x > hi ? hi : x); }
inline double timeCoef(double ms, double fs) { return ms <= 0 ? 0.0 : std::exp(-1.0 / (ms * 0.001 * fs)); }

// ---------------------------------------------------------------- Biquad
struct BiquadCoefs { double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0; };

enum class FilterType { lowpass, highpass, bandpass, peaking, lowshelf, highshelf };

inline BiquadCoefs rbj(FilterType type, double fs, double f0, double q = 0.70710678, double gainDb = 0.0) {
    const double A = std::pow(10.0, gainDb / 40.0);
    const double w0 = 2.0 * kPi * std::min(f0, fs * 0.49) / fs;
    const double cs = std::cos(w0), sn = std::sin(w0);
    const double alpha = sn / (2.0 * q);
    double b0, b1, b2, a0, a1, a2;
    switch (type) {
        case FilterType::lowpass:
            b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
        case FilterType::highpass:
            b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
        case FilterType::bandpass:
            b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
        case FilterType::peaking:
            b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; break;
        case FilterType::lowshelf: {
            const double s = 2 * std::sqrt(A) * alpha;
            b0 = A * (A + 1 - (A - 1) * cs + s); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - s);
            a0 = A + 1 + (A - 1) * cs + s; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - s; break;
        }
        case FilterType::highshelf:
        default: {
            const double s = 2 * std::sqrt(A) * alpha;
            b0 = A * (A + 1 + (A - 1) * cs + s); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - s);
            a0 = A + 1 - (A - 1) * cs + s; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - s; break;
        }
    }
    return { b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0 };
}

inline double magnitudeAt(const BiquadCoefs& c, double f, double fs) {
    const double w = 2 * kPi * f / fs;
    const double nr = c.b0 + c.b1 * std::cos(w) + c.b2 * std::cos(2 * w);
    const double ni = -c.b1 * std::sin(w) - c.b2 * std::sin(2 * w);
    const double dr = 1 + c.a1 * std::cos(w) + c.a2 * std::cos(2 * w);
    const double di = -c.a1 * std::sin(w) - c.a2 * std::sin(2 * w);
    return std::sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

struct Biquad {
    BiquadCoefs c;
    double z1 = 0, z2 = 0;
    void set(const BiquadCoefs& k) { c = k; }
    void reset() { z1 = z2 = 0; }
    inline double process(double x) {
        const double y = c.b0 * x + z1;
        z1 = c.b1 * x - c.a1 * y + z2;
        z2 = c.b2 * x - c.a2 * y;
        if (std::abs(z1) < 1e-20) z1 = 0;
        if (std::abs(z2) < 1e-20) z2 = 0;
        return y;
    }
};

/** パラメータが変わったときだけ係数を再計算するフィルタ */
struct SmartBiquad {
    Biquad f;
    FilterType type = FilterType::peaking;
    double fs = 48000, freq = -1, q = -1, gain = -999;
    void update(FilterType t, double sampleRate, double fr, double qq, double g) {
        if (t == type && sampleRate == fs && fr == freq && qq == q && g == gain) return;
        type = t; fs = sampleRate; freq = fr; q = qq; gain = g;
        f.set(rbj(t, sampleRate, fr, qq, g));
    }
    inline double process(double x) { return f.process(x); }
    void reset() { f.reset(); }
};

// ---------------------------------------------------------------- Envelope
struct EnvelopeFollower {
    double fs = 48000, env = 0, ca = 0, cr = 0, a = -1, r = -1;
    void init(double sampleRate, double attackMs, double releaseMs) { fs = sampleRate; a = r = -1; setTimes(attackMs, releaseMs); }
    void setTimes(double attackMs, double releaseMs) {
        if (attackMs == a && releaseMs == r) return;
        a = attackMs; r = releaseMs;
        ca = timeCoef(attackMs, fs); cr = timeCoef(releaseMs, fs);
    }
    inline double process(double x) {
        const double v = std::abs(x);
        const double c = v > env ? ca : cr;
        env = v + c * (env - v);
        return env;
    }
};

// ---------------------------------------------------------------- Dynamics
inline double gainComputer(double xDb, double thr, double ratio, double knee) {
    const double over = xDb - thr;
    const double slope = 1.0 / ratio - 1.0;
    if (knee > 0 && 2 * std::abs(over) <= knee) {
        const double t = over + knee / 2;
        return slope * t * t / (2 * knee);
    }
    return over > 0 ? over * slope : 0.0;
}

struct CompressorParams { double threshold = -18, ratio = 4, knee = 6, attack = 5, release = 100, makeup = 0; bool rms = false; };

class Compressor {
public:
    double gr = 0;
    void init(double sampleRate) { fs = sampleRate; rmsCoef = timeCoef(10, fs); a = r = -1; set(p); }
    void set(const CompressorParams& np) {
        p = np;
        p.ratio = std::max(1.0, p.ratio);
        if (p.attack != a || p.release != r) {
            a = p.attack; r = p.release;
            ca = timeCoef(a, fs); cr = timeCoef(r, fs); crSlow = timeCoef(r * 3, fs);
        }
        makeupLin = dbToLin(p.makeup);
    }
    /** level: 検波対象の絶対値。出力ゲイン（リニア）を返す */
    inline double gain(double level) {
        double x = level;
        if (p.rms) { ms = x * x + rmsCoef * (ms - x * x); x = std::sqrt(ms) * 1.41421356; }
        const double target = -gainComputer(linToDb(x), p.threshold, p.ratio, p.knee);
        const double c = target > gr ? ca : (gr > 6 ? crSlow : cr);
        gr = target + c * (gr - target);
        return dbToLin(-gr) * makeupLin;
    }
    void reset() { gr = 0; ms = 0; }
private:
    CompressorParams p;
    double fs = 48000, ms = 0, rmsCoef = 0, ca = 0, cr = 0, crSlow = 0, a = -1, r = -1, makeupLin = 1;
};

struct ExpanderParams { double threshold = -55, range = 15, ratio = 3, attack = 1, hold = 80, release = 150; };

class Expander {
public:
    double gr = 0;
    void init(double sampleRate) { fs = sampleRate; env.init(fs, 0.5, 40); set(p); }
    void set(const ExpanderParams& np) {
        p = np;
        holdSamples = (int) std::lround(p.hold / 1000.0 * fs);
        ca = timeCoef(p.attack, fs); cr = timeCoef(p.release, fs);
    }
    inline double gain(double x) {
        const double lDb = linToDb(env.process(x));
        double target = 0;
        if (p.range > 0 && lDb < p.threshold) target = std::min(p.range, (p.threshold - lDb) * (std::max(1.0, p.ratio) - 1));
        if (target <= gr) { holdLeft = holdSamples; gr = target + ca * (gr - target); }
        else if (holdLeft > 0) --holdLeft;
        else gr = target + cr * (gr - target);
        return dbToLin(-gr);
    }
private:
    ExpanderParams p;
    EnvelopeFollower env;
    double fs = 48000, ca = 0, cr = 0;
    int holdSamples = 0, holdLeft = 0;
};

/** ダイナミック・ハイシェルフ型ディエッサー */
class DeEsser {
public:
    double gr = 0;
    void init(double sampleRate) { fs = sampleRate; env.init(fs, 0.3, 40); freq = -1; set(6500, -30, 4, 10); }
    void set(double frequency, double threshold, double ratio, double maxReduction) {
        if (frequency != freq) { freq = frequency; hp.set(rbj(FilterType::highpass, fs, freq, 0.7071)); applied = 1e9; }
        thr = threshold; rat = std::max(1.0, ratio); maxRed = maxReduction;
    }
    inline double process(double x) {
        const double h = hp.process(x);
        const double lDb = linToDb(env.process(h));
        double red = 0;
        if (lDb > thr) red = std::min(maxRed, (lDb - thr) * (1 - 1 / rat));
        gr = red;
        if (++counter >= 16) {
            counter = 0;
            if (std::abs(red - applied) >= 0.05) { applied = red; shelf.set(rbj(FilterType::highshelf, fs, freq * 0.8, 0.7071, -red)); }
        }
        return shelf.process(x);
    }
private:
    Biquad hp, shelf;
    EnvelopeFollower env;
    double fs = 48000, freq = -1, thr = -30, rat = 4, maxRed = 10, applied = 1e9;
    int counter = 0;
};

inline double logCosh(double x) { const double a = std::abs(x); return a + std::log1p(std::exp(-2 * a)) - 0.69314718055994531; }

/** ADAA（1次）tanh サチュレーター、並列ミックス内蔵 */
class Saturator {
public:
    void set(double driveDb, double mix01) { drive = dbToLin(driveDb); mix = mix01; }
    inline double process(double input) {
        const double x = input * drive;
        const double f = logCosh(x);
        const double dx = x - xPrev;
        const double wet = std::abs(dx) > 1e-6 ? (f - fPrev) / dx : std::tanh(0.5 * (x + xPrev));
        xPrev = x; fPrev = f;
        const double dry = 0.5 * (input + dryPrev);
        dryPrev = input;
        return dry * (1 - mix) + (wet / drive) * mix;
    }
private:
    double drive = 1, mix = 0, xPrev = 0, fPrev = 0, dryPrev = 0;
};

// ---------------------------------------------------------------- Limiter
/** 先読みリミッター：ホールド最小値＋移動平均でシーリングを超えないことを保証 */
class LookaheadLimiter {
public:
    double gainNow = 1;
    void init(double sampleRate, int channels, double lookaheadMs = 3) {
        fs = sampleRate; C = channels;
        N = std::max(2, (int) std::lround(lookaheadMs / 1000 * fs));
        delay.assign((size_t) C, std::vector<double>((size_t) N, 0.0));
        dqVal.assign((size_t) N + 1, 0); dqIdx.assign((size_t) N + 1, 0);
        box.assign((size_t) N, 1.0); boxSum = N; boxPos = 0; w = 0; n = 0; head = tail = 0; e = 1;
        set(-1, 80);
    }
    int latency() const { return N - 1; }
    void set(double ceilingDb, double releaseMs) { ceiling = dbToLin(ceilingDb); rc = timeCoef(releaseMs, fs); }
    /** チャンネル毎のポインタ。in-place 可 */
    void process(float* const* io, int frames) {
        for (int i = 0; i < frames; ++i) {
            double peak = 0;
            for (int c = 0; c < C; ++c) peak = std::max(peak, (double) std::abs(io[c][i]));
            const double r = peak > ceiling ? ceiling / peak : 1.0;
            const double h = push(r, n++);
            e = h < e ? h : h + rc * (e - h);
            boxSum += e - box[(size_t) boxPos];
            box[(size_t) boxPos] = e;
            boxPos = (boxPos + 1) % N;
            if (boxPos == 0) { double s = 0; for (double v : box) s += v; boxSum = s; }
            const double g = std::min(1.0, boxSum / N);
            gainNow = g;
            const int readPos = (w + 1) % N;
            for (int c = 0; c < C; ++c) {
                auto& buf = delay[(size_t) c];
                buf[(size_t) w] = io[c][i];
                io[c][i] = (float) (buf[(size_t) readPos] * g);
            }
            w = readPos;
        }
    }
private:
    double push(double v, int64_t idx) {
        const int cap = N + 1;
        while (head != tail) {
            const int back = (tail - 1 + cap) % cap;
            if (dqVal[(size_t) back] >= v) tail = back; else break;
        }
        dqVal[(size_t) tail] = v; dqIdx[(size_t) tail] = idx; tail = (tail + 1) % cap;
        while (dqIdx[(size_t) head] <= idx - N) head = (head + 1) % cap;
        return dqVal[(size_t) head];
    }
    double fs = 48000, ceiling = 0.89, rc = 0, boxSum = 0, e = 1;
    int C = 2, N = 144, boxPos = 0, w = 0, head = 0, tail = 0;
    int64_t n = 0;
    std::vector<std::vector<double>> delay;
    std::vector<double> dqVal, box;
    std::vector<int64_t> dqIdx;
};

// ---------------------------------------------------------------- Loudness (BS.1770)
inline std::array<BiquadCoefs, 2> kWeighting(double fs) {
    double f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    double K = std::tan(kPi * f0 / fs);
    const double Vh = std::pow(10.0, G / 20), Vb = std::pow(Vh, 0.4996667741545416);
    double a0 = 1 + K / Q + K * K;
    BiquadCoefs s1 { (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0 };
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = std::tan(kPi * f0 / fs);
    a0 = 1 + K / Q + K * K;
    BiquadCoefs s2 { 1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0 };
    return { s1, s2 };
}
inline double powerToLufs(double p) { return p > 0 ? -0.691 + 10 * std::log10(p) : -INFINITY; }

class LoudnessMeter {
public:
    void init(double sampleRate, int channels) {
        fs = sampleRate; C = channels;
        const auto k = kWeighting(fs);
        f1.assign((size_t) C, Biquad {}); f2.assign((size_t) C, Biquad {});
        for (int c = 0; c < C; ++c) { f1[(size_t) c].set(k[0]); f2[(size_t) c].set(k[1]); }
        subLen = (int) std::lround(fs * 0.1);
        reset();
    }
    void reset() { acc = 0; accN = 0; subs.fill(0); subCount = 0; subPos = 0; blocks.clear(); }
    void push(const float* const* ch, int frames) {
        for (int i = 0; i < frames; ++i) {
            double sum = 0;
            for (int c = 0; c < C; ++c) {
                const double y = f2[(size_t) c].process(f1[(size_t) c].process(ch[c][i]));
                sum += y * y;
            }
            acc += sum;
            if (++accN >= subLen) {
                subs[(size_t) subPos] = acc / subLen; subPos = (subPos + 1) % 30; ++subCount; acc = 0; accN = 0;
                if (subCount >= 4) {
                    if (blocks.size() >= 72000) blocks.erase(blocks.begin());
                    blocks.push_back(meanSubs(4));
                }
            }
        }
    }
    double momentary() const { return powerToLufs(meanSubs(4)); }
    double shortTerm() const { return powerToLufs(meanSubs(30)); }
    double integrated() const {
        const double absThr = std::pow(10.0, (-70 + 0.691) / 10);
        double s = 0; int n = 0;
        for (double p : blocks) if (p > absThr) { s += p; ++n; }
        if (n == 0) return -INFINITY;
        const double rel = s / n * 0.1;
        double s2 = 0; int n2 = 0;
        for (double p : blocks) if (p > absThr && p > rel) { s2 += p; ++n2; }
        return n2 ? powerToLufs(s2 / n2) : -INFINITY;
    }
private:
    double meanSubs(int n) const {
        const int k = std::min(n, subCount);
        if (k == 0) return 0;
        double s = 0;
        for (int j = 1; j <= k; ++j) s += subs[(size_t) ((subPos - j + 30) % 30)];
        return s / k;
    }
    double fs = 48000, acc = 0;
    int C = 2, subLen = 4800, accN = 0, subCount = 0, subPos = 0;
    std::array<double, 30> subs {};
    std::vector<Biquad> f1, f2;
    std::vector<double> blocks;
};

// ---------------------------------------------------------------- ライブ自動化
/** ボーカルライダー：伴奏の中域レベルを基準にボーカルのゲインを自動で上下 */
class VocalRider {
public:
    double gDb = 0;
    void init(double sampleRate) {
        fs = sampleRate;
        const auto hp = rbj(FilterType::highpass, fs, 200, 0.7071), lp = rbj(FilterType::lowpass, fs, 5000, 0.7071);
        for (auto* b : { &vf0, &mf0 }) b->set(hp);
        for (auto* b : { &vf1, &mf1 }) b->set(lp);
        detCoef = timeCoef(300, fs); speed = -1;
    }
    void set(double offsetDb, double rangeDb, double speedMs, double vocalFloorDb, bool enabledFlag) {
        offset = offsetDb; range = rangeDb; floorDb = vocalFloorDb; enabled = enabledFlag;
        if (speedMs != speed) { speed = speedMs; gCoef = timeCoef(speedMs, fs); }
    }
    inline double gain(double v, double m) {
        const double vb = vf1.process(vf0.process(v)), mb = mf1.process(mf0.process(m));
        vms = vb * vb + detCoef * (vms - vb * vb);
        mms = mb * mb + detCoef * (mms - mb * mb);
        if (++counter >= 32) {
            counter = 0;
            const double vDb = powToDb(vms), mDb = powToDb(mms);
            if (!enabled) targetDb = 0;
            else if (vDb > floorDb && mDb > -60) targetDb = clampd(mDb + offset - vDb, -range, range);
        }
        gDb = targetDb + gCoef * (gDb - targetDb);
        return dbToLin(gDb);
    }
private:
    Biquad vf0, vf1, mf0, mf1;
    double fs = 48000, vms = 0, mms = 0, targetDb = 0, detCoef = 0, gCoef = 0, speed = -1;
    double offset = 0, range = 6, floorDb = -50;
    bool enabled = true;
    int counter = 0;
};

/** フレーズ終わり検出 → センド・スロー制御信号 0..1 */
class PhraseThrow {
public:
    double out = 0;
    int triggers = 0;
    void init(double sampleRate) { fs = sampleRate; env.init(fs, 5, 60); atkCoef = timeCoef(10, fs); set(-40, 150, 600, 250, 500, true); }
    void set(double thresholdDb, double gapMs, double minPhraseMs, double holdMs, double releaseMs, bool enabledFlag) {
        thr = thresholdDb;
        gapS = (int64_t) std::lround(gapMs / 1000 * fs);
        minS = (int64_t) std::lround(minPhraseMs / 1000 * fs);
        holdS = (int64_t) std::lround(holdMs / 1000 * fs);
        if (releaseMs != rel) { rel = releaseMs; relCoef = timeCoef(releaseMs, fs); }
        enabled = enabledFlag;
    }
    inline double process(double x) {
        const double lDb = linToDb(env.process(x));
        if (lDb > thr) { active += 1 + (silent < gapS ? silent : 0); silent = 0; }
        else {
            ++silent;
            if (silent == gapS) {
                if (active >= minS && enabled) { holdLeft = holdS; ++triggers; }
                active = 0;
            }
        }
        double target = 0, c = relCoef;
        if (holdLeft > 0) { --holdLeft; target = 1; c = atkCoef; }
        out = target + c * (out - target);
        return out;
    }
private:
    EnvelopeFollower env;
    double fs = 48000, thr = -40, atkCoef = 0, relCoef = 0, rel = -1;
    int64_t gapS = 0, minS = 0, holdS = 0, active = 0, silent = 0, holdLeft = 0;
    bool enabled = true;
};

/** 歌っている間だけ伴奏の帯域を下げる量(dB, ≤0)を出す */
class CarveControl {
public:
    double out = 0;
    void init(double sampleRate) { env.init(sampleRate, 10, 200); smooth = timeCoef(30, sampleRate); }
    void set(double thresholdDb, double depthDb) { thr = thresholdDb; depth = depthDb; }
    inline double process(double x) {
        const double lDb = linToDb(env.process(x));
        const double target = -depth * clampd((lDb - thr) / 12, 0, 1);
        out = target + smooth * (out - target);
        return out;
    }
private:
    EnvelopeFollower env;
    double smooth = 0, thr = -40, depth = 3;
};

/** 伴奏オートゲイン（100ms ブロックのゲート付き長時間ラウドネスを目標値へ） */
class AutoGain {
public:
    double gDb = 0;
    void init(double sampleRate, int channels) {
        fs = sampleRate; C = channels;
        const auto k = kWeighting(fs);
        f1.assign((size_t) C, Biquad {}); f2.assign((size_t) C, Biquad {});
        for (int c = 0; c < C; ++c) { f1[(size_t) c].set(k[0]); f2[(size_t) c].set(k[1]); }
        blockLen = (int) std::lround(fs * 0.1);
        gateP = std::pow(10.0, (-50 + 0.691) / 10);
        relearn();
    }
    void set(double targetLufs, double maxGainDb, double slewDbPerSec, bool enabledFlag, bool freezeFlag) {
        target = targetLufs; maxGain = maxGainDb; slew = slewDbPerSec / fs; enabled = enabledFlag; freeze = freezeFlag;
    }
    double loudness() const { return powerToLufs(p); }
    void relearn() { blocks = 0; p = 0; acc = 0; accN = 0; }
    inline double frame(const float* const* ch, int i) {
        double s = 0;
        for (int c = 0; c < C; ++c) {
            const double y = f2[(size_t) c].process(f1[(size_t) c].process(ch[c][i]));
            s += y * y;
        }
        acc += s;
        if (++accN >= blockLen) { block(acc / blockLen); acc = 0; accN = 0; }
        if (!enabled) gDb += clampd(-gDb, -slew * 20, slew * 20);
        else if (!freeze && blocks > 0) gDb += clampd(clampd(target - loudness(), -maxGain, maxGain) - gDb, -slew, slew);
        return dbToLin(gDb);
    }
private:
    void block(double bp) {
        if (bp < gateP || (blocks > 0 && bp < p * 0.1)) return;
        ++blocks;
        const double c = blocks < 80 ? 1 - 1.0 / blocks : 1 - 1.0 / 80;
        p = bp + c * (p - bp);
    }
    std::vector<Biquad> f1, f2;
    double fs = 48000, p = 0, acc = 0, gateP = 0, target = -16, maxGain = 12, slew = 0;
    int C = 2, blockLen = 4800, accN = 0, blocks = 0;
    bool enabled = true, freeze = false;
};

// ---------------------------------------------------------------- 遅延線
/** 線形補間読み出しのディレイライン（遅延時間はスムージングして使う） */
class DelayLine {
public:
    void init(int maxSamples) { buf.assign((size_t) maxSamples + 4, 0.0f); w = 0; }
    inline void write(float x) { buf[(size_t) w] = x; w = (w + 1) % (int) buf.size(); }
    /** 直前に write した値を 0 とした遅延（サンプル、≥1 推奨） */
    inline float read(double delaySamples) const {
        const int size = (int) buf.size();
        delaySamples = clampd(delaySamples, 0.0, size - 3.0);
        double pos = w - 1 - delaySamples;
        while (pos < 0) pos += size;
        const int i0 = (int) pos;
        const double frac = pos - i0;
        const float a = buf[(size_t) i0], b = buf[(size_t) ((i0 + 1) % size)];
        return (float) (a + (b - a) * frac);
    }
    void clear() { std::fill(buf.begin(), buf.end(), 0.0f); }
private:
    std::vector<float> buf;
    int w = 0;
};

// ---------------------------------------------------------------- Reverb IR
struct Rng {
    uint32_t a;
    explicit Rng(uint32_t seed) : a(seed) {}
    double next() {
        a += 0x6d2b79f5u;
        uint32_t t = a;
        t = (t ^ (t >> 15)) * (t | 1u);
        t ^= t + ((t ^ (t >> 7)) * (t | 61u));
        return ((t ^ (t >> 14))) / 4294967296.0;
    }
};

enum class ReverbType { plate = 0, hall, room, chamber };

/** プレート/ホール/ルーム/チェンバーのインパルス応答を生成（L, R） */
inline std::array<std::vector<float>, 2> generateIR(double fs, double decay, ReverbType type, double damping = -1, double width = 1, uint32_t seed = 7) {
    struct T { double onsetMs, damp; std::vector<std::pair<double, double>> er; };
    static const T types[] = {
        { 1, 0.35, {} },
        { 18, 0.6, { { 11, 0.5 }, { 19, 0.42 }, { 27, 0.36 }, { 38, 0.3 }, { 52, 0.24 }, { 67, 0.18 } } },
        { 4, 0.7, { { 3, 0.6 }, { 7, 0.5 }, { 11, 0.4 }, { 16, 0.32 }, { 22, 0.25 } } },
        { 6, 0.5, { { 5, 0.45 }, { 9, 0.4 }, { 14, 0.33 }, { 21, 0.27 }, { 29, 0.2 } } },
    };
    const T& t = types[(int) type];
    const double damp = damping >= 0 ? damping : t.damp;
    const size_t len = (size_t) std::max(1.0, std::ceil(fs * std::min(decay * 1.4, 10.0)));
    Rng rnd(seed);
    auto noise = [&] { return (rnd.next() + rnd.next() + rnd.next() - 1.5) * 1.15; };
    std::array<std::vector<float>, 2> out { std::vector<float>(len), std::vector<float>(len) };
    const double k = 6.907755 / (decay * fs);
    const double onset = std::max(1.0, t.onsetMs / 1000 * fs);
    const double fHi = 16000, fLo = 16000 * (1 - damp) + 1500 * damp;
    double yl = 0, yr = 0;
    for (size_t n = 0; n < len; ++n) {
        const double env = std::exp(-k * (double) n) * std::min(1.0, (double) n / onset);
        const double prog = std::min(1.0, (double) n / (decay * fs));
        const double fc = fHi * std::pow(fLo / fHi, prog);
        const double a = 1 - std::exp(-2 * kPi * fc / fs);
        const double common = noise(), nl = noise(), nr = noise();
        yl += a * ((common * (1 - width) + nl * width) - yl);
        yr += a * ((common * (1 - width) + nr * width) - yr);
        const double comp = 1 / std::sqrt(std::max(a / (2 - a), 1e-4));
        out[0][n] = (float) (yl * env * comp);
        out[1][n] = (float) (yr * env * comp);
    }
    for (const auto& [ms, g] : t.er) {
        const size_t il = (size_t) std::lround(ms / 1000 * fs), ir = (size_t) std::lround(ms * 1.13 / 1000 * fs);
        if (il < len) out[0][il] += (float) (g * (rnd.next() > 0.5 ? 1 : -1));
        if (ir < len) out[1][ir] += (float) (g * (rnd.next() > 0.5 ? 1 : -1));
    }
    const size_t fade = std::min(len, (size_t) std::lround(fs * 0.05));
    for (size_t i = 0; i < fade; ++i) {
        const float g = (float) i / (float) fade;
        out[0][len - 1 - i] *= g; out[1][len - 1 - i] *= g;
    }
    return out;
}

inline double estimateRT60(const std::vector<float>& ir, double fs) {
    std::vector<double> edc(ir.size());
    double acc = 0;
    for (size_t i = ir.size(); i-- > 0;) { acc += (double) ir[i] * ir[i]; edc[i] = acc; }
    const double total = edc[0];
    long i5 = -1, i25 = -1;
    for (size_t i = 0; i < edc.size(); ++i) {
        const double db = 10 * std::log10(edc[i] / total);
        if (i5 < 0 && db <= -5) i5 = (long) i;
        if (i25 < 0 && db <= -25) { i25 = (long) i; break; }
    }
    if (i5 < 0 || i25 < 0) return NAN;
    return (double) (i25 - i5) / fs * 3;
}

} // namespace ul
