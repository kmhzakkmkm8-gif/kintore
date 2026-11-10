// DSP コアのテスト（Web 版 test/dsp_test.mjs と同じ検証内容）
#include "../Source/dsp/Dsp.h"
#include <cstdio>
#include <functional>
#include <string>

using namespace ul;
static int failures = 0;
static void check(bool ok, const std::string& what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok) ++failures;
}
static bool near(double a, double b, double tol) { return std::abs(a - b) <= tol; }
static std::vector<float> sine(double f, double amp, double sec, double fs = 48000) {
    std::vector<float> v((size_t) (sec * fs));
    for (size_t i = 0; i < v.size(); ++i) v[i] = (float) (amp * std::sin(2 * kPi * f * (double) i / fs));
    return v;
}
static double rms(const std::vector<float>& v, size_t from) {
    double s = 0;
    for (size_t i = from; i < v.size(); ++i) s += (double) v[i] * v[i];
    return std::sqrt(s / (double) (v.size() - from));
}

int main() {
    const double FS = 48000;
    check(near(linToDb(magnitudeAt(rbj(FilterType::peaking, FS, 3000, 1, 4), 3000, FS)), 4, 0.01), "biquad peaking");
    check(near(linToDb(magnitudeAt(rbj(FilterType::highpass, FS, 100), 100, FS)), -3.01, 0.05), "biquad highpass -3dB");
    check(near(gainComputer(-8, -20, 4, 0), -9, 1e-9), "gainComputer");
    {
        Compressor c; c.init(FS);
        c.set({ -20, 4, 0, 10, 100, 0, true });
        double g = 1;
        for (float s : sine(1000, dbToLin(-8), 1)) g = c.gain(std::abs(s));
        check(near(linToDb(g), -9, 0.3), "compressor RMS static curve");
    }
    {
        Expander e; e.init(FS); e.set({ -50, 20, 3, 1, 50, 50 });
        double g = 1;
        for (float s : sine(500, dbToLin(-80), 1)) g = e.gain(s);
        check(near(linToDb(g), -20, 0.1), "expander range");
    }
    {
        auto run = [&](double f) {
            DeEsser d; d.init(FS); d.set(6000, -30, 4, 10);
            auto x = sine(f, dbToLin(-6), 0.5);
            auto y = x;
            for (auto& s : y) s = (float) d.process(s);
            return linToDb(rms(y, 12000) / rms(x, 12000));
        };
        check(near(run(300), 0, 0.2), "de-esser keeps lows");
        check(run(9000) < -6, "de-esser cuts 9kHz");
    }
    {
        LookaheadLimiter L; L.init(FS, 2, 3); L.set(-1, 50);
        Rng r(42);
        std::vector<float> l(48000), rr(48000);
        for (size_t i = 0; i < l.size(); ++i) {
            const double b = (i % 4800) < 200 ? 8 : 0.3;
            l[i] = (float) ((r.next() * 2 - 1) * b); rr[i] = (float) ((r.next() * 2 - 1) * b * 0.5);
        }
        for (size_t i = 0; i < l.size(); i += 128) { float* io[2] = { l.data() + i, rr.data() + i }; L.process(io, 128); }
        double pk = 0;
        for (size_t i = 0; i < l.size(); ++i) pk = std::max({ pk, (double) std::abs(l[i]), (double) std::abs(rr[i]) });
        check(pk <= dbToLin(-1) + 1e-6, "limiter ceiling");
    }
    {
        LoudnessMeter m; m.init(FS, 2);
        auto x = sine(1000, 0.5, 4);
        std::vector<float> z(x.size());
        const float* ch[2] = { x.data(), z.data() };
        m.push(ch, (int) x.size());
        check(near(m.integrated(), -3.01 + linToDb(0.5), 0.1), "loudness 1kHz");
    }
    {
        VocalRider r; r.init(FS); r.set(0, 6, 100, -50, true);
        auto v = sine(1000, dbToLin(-24), 2), m = sine(1500, dbToLin(-20), 2);
        double g = 1;
        for (size_t i = 0; i < v.size(); ++i) g = r.gain(v[i], m[i]);
        check(near(linToDb(g), 4, 0.5), "rider follows music");
    }
    {
        PhraseThrow t; t.init(FS); t.set(-40, 150, 600, 250, 300, true);
        for (auto [a, s] : std::vector<std::pair<double, double>> { { 0.3, 0.5 }, { 0, 0.08 }, { 0.3, 0.5 }, { 0, 1 }, { 0.3, 0.2 }, { 0, 1 } })
            for (float x : sine(300, a, s)) t.process(x);
        check(t.triggers == 1, "phrase throw triggers once");
    }
    {
        AutoGain a; a.init(FS, 1); a.set(-16, 12, 4, true, false);
        auto x = sine(1000, dbToLin(-24 + 3.01), 12);
        const float* ch[1] = { x.data() };
        double g = 1;
        for (int i = 0; i < (int) x.size(); ++i) g = a.frame(ch, i);
        check(near(linToDb(g), 8, 0.5), "autogain");
    }
    for (double d : { 0.8, 2.0 }) {
        auto ir = generateIR(FS, d, ReverbType::plate, 0);
        check(near(estimateRT60(ir[0], FS), d, d * 0.15), "reverb RT60 " + std::to_string(d));
    }
    {
        DelayLine dl; dl.init(1000);
        for (int i = 0; i < 100; ++i) dl.write((float) i);
        check(near(dl.read(10), 89, 1e-6) && near(dl.read(10.5), 88.5, 1e-6), "delay line");
    }
    std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
