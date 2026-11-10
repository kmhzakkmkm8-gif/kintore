// 別クロックの音声（ブラウザから送られてくるタブ音声・別デバイス）をメインのオーディオデバイスへ
// ズレなく受け渡すためのブリッジ。SPSC FIFO ＋ 充填量を一定に保つ PI 制御の可変レート再サンプリング。
#pragma once
#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>

namespace ul {

class ClockBridge {
public:
    explicit ClockBridge(int capacityFrames = 48000 * 2) : fifo(capacityFrames) {
        bufL.resize((size_t) capacityFrames);
        bufR.resize((size_t) capacityFrames);
        tmpL.resize(16384);
        tmpR.resize(16384);
    }

    /** 受け側（consumer）のレートと目標バッファ量。producer レートは push 側で設定 */
    void setConsumerRate(double r) { consumerRate.store(r); requestReset(); }
    void setProducerRate(double r) { producerRate.store(r); requestReset(); }
    void setTargetLatencyMs(double ms) { targetMs.store(ms); }
    void requestReset() { resetFlag.store(true); }

    // ---- producer thread
    void push(const float* L, const float* R, int n) {
        if (n <= 0) return;
        if (fifo.getFreeSpace() < n) { overruns.fetch_add(1); return; }
        int s1, b1, s2, b2;
        fifo.prepareToWrite(n, s1, b1, s2, b2);
        if (b1 > 0) { std::copy(L, L + b1, bufL.data() + s1); std::copy(R ? R : L, (R ? R : L) + b1, bufR.data() + s1); }
        if (b2 > 0) { std::copy(L + b1, L + b1 + b2, bufL.data() + s2); std::copy((R ? R : L) + b1, (R ? R : L) + b1 + b2, bufR.data() + s2); }
        fifo.finishedWrite(b1 + b2);
        lastPushMs.store(juce::Time::getMillisecondCounter());
    }

    // ---- consumer thread
    void pull(float* L, float* R, int n) {
        const double pr = producerRate.load(), cr = consumerRate.load();
        if (resetFlag.exchange(false)) {
            primed = false;
            integ = 0;
            interpL.reset();
            interpR.reset();
        }
        auto silence = [&] { std::fill(L, L + n, 0.0f); std::fill(R, R + n, 0.0f); };
        if (pr <= 0 || cr <= 0 || n > 8192) { silence(); return; }
        const double target = std::max(64.0, targetMs.load() * 0.001 * pr);
        int avail = fifo.getNumReady();
        if (!primed) {
            if (avail < target) { silence(); return; }
            // 溜まりすぎていたら目標量まで捨ててから開始
            if (avail > target * 1.5) fifo.finishedRead(avail - (int) target);
            primed = true;
            integ = 0;
            avail = fifo.getNumReady();
            fillAvg = avail;
        }
        if (avail > target * 4) { // 大きく溜まった（producer 側が一時停止していた等）→ 追いつく
            fifo.finishedRead(avail - (int) target);
            avail = fifo.getNumReady();
            fillAvg = avail;
            jumps.fetch_add(1);
        }
        fillAvg += (avail - fillAvg) * 0.01; // producer のブロック単位の揺れをならす
        const double err = (fillAvg - target) / target;
        // PI 制御（固有周期 約60秒・減衰比 約0.7）。積分項が「定常的なクロックのずれ」の推定値になる
        integ = juce::jlimit(-0.004, 0.004, integ + err * 4e-4 * (n / cr));
        const double corr = juce::jlimit(-0.01, 0.01, err * 0.006 + integ);
        const double ratio = pr / cr * (1.0 + corr);
        const int needed = (int) std::ceil(n * ratio) + 4;
        if (needed > (int) tmpL.size() || avail < needed) {
            underruns.fetch_add(1);
            primed = false;
            silence();
            return;
        }
        int s1, b1, s2, b2;
        fifo.prepareToRead(needed, s1, b1, s2, b2);
        std::copy(bufL.data() + s1, bufL.data() + s1 + b1, tmpL.data());
        std::copy(bufR.data() + s1, bufR.data() + s1 + b1, tmpR.data());
        if (b2 > 0) {
            std::copy(bufL.data() + s2, bufL.data() + s2 + b2, tmpL.data() + b1);
            std::copy(bufR.data() + s2, bufR.data() + s2 + b2, tmpR.data() + b1);
        }
        const int used = interpL.process(ratio, tmpL.data(), L, n);
        interpR.process(ratio, tmpR.data(), R, n);
        fifo.finishedRead(juce::jmin(used, needed));
        fillMs.store((float) (avail / pr * 1000.0));
        ppm.store((float) (integ * 1e6));
    }

    bool isActive() const { return juce::Time::getMillisecondCounter() - lastPushMs.load() < 500; }

    std::atomic<float> fillMs { 0 }, ppm { 0 };
    std::atomic<int> underruns { 0 }, overruns { 0 }, jumps { 0 };

private:
    juce::AbstractFifo fifo;
    std::vector<float> bufL, bufR, tmpL, tmpR;
    juce::WindowedSincInterpolator interpL, interpR;
    std::atomic<double> producerRate { 0 }, consumerRate { 0 }, targetMs { 40 };
    std::atomic<bool> resetFlag { true };
    std::atomic<juce::uint32> lastPushMs { 0 };
    bool primed = false;
    double integ = 0, fillAvg = 0;
};

} // namespace ul
