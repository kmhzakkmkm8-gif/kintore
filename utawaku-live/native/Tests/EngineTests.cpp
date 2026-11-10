// エンジン全体のオフラインテスト：実際の VST3 を読み込んでボーカル経路に挿し、
// ゲイン・レイテンシ取得・バイパス・リミッター・ClockBridge を検証する。
#include "../Source/MixerEngine.h"
#include <cstdio>

using namespace ul;
static int failures = 0;
static void check(bool ok, const juce::String& what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.toRawUTF8());
    if (!ok) ++failures;
}

struct Rig {
    MixerEngine e;
    static constexpr int N = 256, IN = 4, OUT = 4;
    juce::AudioBuffer<float> in { IN, N }, out { OUT, N };
    double ph1 = 0, ph2 = 0;
    float monPk = 0, streamPk = 0;
    double monSq = 0;
    long monN = 0;
    bool finite = true;
    Rig() {
        e.prepare(48000, N);
        e.musicSource.store((int) MusicSource::deviceInputs);
        e.musicInputCh.store(2);
        e.monitorOutCh.store(0);
        e.streamOutCh.store(2);
    }
    void run(double seconds, float vocalAmp, float musicAmp) {
        monPk = streamPk = 0;
        monSq = 0;
        monN = 0;
        for (int b = 0; b < (int) (seconds * 48000 / N); ++b) {
            for (int i = 0; i < N; ++i) {
                in.setSample(0, i, (float) (vocalAmp * std::sin(ph1)));
                in.setSample(1, i, 0);
                in.setSample(2, i, (float) (musicAmp * std::sin(ph2)));
                in.setSample(3, i, (float) (musicAmp * std::sin(ph2 * 1.5)));
                ph1 += 2 * kPi * 440 / 48000;
                ph2 += 2 * kPi * 220 / 48000;
            }
            e.process(in.getArrayOfReadPointers(), IN, out.getArrayOfWritePointers(), OUT, N);
            for (int c = 0; c < OUT; ++c)
                for (int i = 0; i < N; ++i) {
                    const float x = out.getSample(c, i);
                    if (!std::isfinite(x)) finite = false;
                    if (c < 2) {
                        monPk = std::max(monPk, std::abs(x));
                        if (c == 0) { monSq += (double) x * x; ++monN; }
                    } else
                        streamPk = std::max(streamPk, std::abs(x));
                }
        }
    }
    double monRmsDb() const { return 10 * std::log10(monSq / (double) std::max(1L, monN) + 1e-30); }
};

static void engineBasics() {
    Rig r;
    r.e.setParam(mstDrive, 12, 0); // 強めに突っ込んでもシーリングを守るか
    r.run(3, 0.5f, 0.5f);
    check(r.finite, juce::String::fromUTF8("出力に NaN/Inf がない"));
    check(r.monPk > 0.01f, juce::String::fromUTF8("モニターに音が出る"));
    check(r.streamPk > 0.01f, juce::String::fromUTF8("配信出力に音が出る"));
    check(r.streamPk <= (float) dbToLin(-1) + 1e-4f, juce::String::fromUTF8("配信出力はシーリング -1dBFS 以下 (peak ") + juce::String(linToDb(r.streamPk), 2) + ")");
    check(std::isfinite(r.e.meters.lufsS.load()), juce::String::fromUTF8("ラウドネスメーターが動く"));
    r.e.panic(true);
    r.run(0.2, 0.5f, 0.5f);
    r.run(0.2, 0.5f, 0.5f);
    check(r.monPk < 1e-4f && r.streamPk < 1e-4f, juce::String::fromUTF8("PANIC で無音"));
}

static void vst3Hosting() {
    juce::AudioPluginFormatManager fm;
    fm.addDefaultFormats();
    // TARGET_FILE_DIR は「UL Test Gain.vst3/Contents/<arch>」なので2階層上がバンドル
    auto bundle = juce::File(UL_TEST_PLUGIN_BINDIR).getParentDirectory().getParentDirectory();
    check(bundle.exists(), juce::String::fromUTF8("テスト用 VST3 がビルドされている: ") + bundle.getFullPathName());
    juce::OwnedArray<juce::PluginDescription> found;
    juce::KnownPluginList list;
    for (auto* f : fm.getFormats())
        if (f->getName() == "VST3") list.scanAndAddFile(bundle.getFullPathName(), true, found, *f);
    check(found.size() == 1, juce::String::fromUTF8("VST3 をスキャンして検出"));
    if (found.isEmpty()) return;

    Rig r;
    for (int p : { revSend, dlySend, throwAmount, dblSend }) r.e.setParam(p, -60, 0);
    r.e.setParam(riderOn, 0, 0);
    r.e.setParam(mMute, 1, 0);
    r.e.setParam(monVTap, 1, 0);
    r.e.setParam(gateRange, 0, 0);
    r.run(1, 0.05f, 0.0f);
    r.run(1, 0.05f, 0.0f);
    const double before = r.monRmsDb();

    juce::String err;
    auto inst = fm.createPluginInstance(*found[0], 48000, Rig::N, err);
    check(inst != nullptr, juce::String::fromUTF8("VST3 のインスタンス生成 ") + err);
    if (!inst) return;
    r.e.chains[chainVocal]->setPlugin(0, std::move(inst));
    check(r.e.vocalPluginLatency() == 64, juce::String::fromUTF8("プラグインのレイテンシ (64) を取得: ") + juce::String(r.e.vocalPluginLatency()));
    r.run(1, 0.05f, 0.0f);
    const double after = r.monRmsDb();
    check(std::abs((after - before) + 6.02) < 0.3, juce::String::fromUTF8("VST3 の処理が効いている (-6dB): ") + juce::String(after - before, 2) + " dB");

    r.e.chains[chainVocal]->setBypassed(0, true);
    r.run(1, 0.05f, 0.0f);
    check(std::abs(r.monRmsDb() - before) < 0.3, juce::String::fromUTF8("バイパスで元に戻る: ") + juce::String(r.monRmsDb() - before, 2) + " dB");

    auto xml = r.e.chains[chainVocal]->toXml();
    check(xml->getChildByName("Slot") != nullptr && xml->toString().contains("UL Test Gain"), juce::String::fromUTF8("チェーン状態を XML に保存"));
    r.e.chains[chainVocal]->removePlugin(0).reset();
    check(r.e.vocalPluginLatency() == 0, juce::String::fromUTF8("外すとレイテンシ 0"));
}

static void clockBridge() {
    ClockBridge b;
    b.setTargetLatencyMs(40);
    const double prodRate = 48000 * 1.0003; // 300ppm 速いクロック
    b.setProducerRate(48000);
    b.setConsumerRate(48000);
    std::vector<float> L(480), R(480), oL(256), oR(256);
    double tProd = 0, tCons = 0, ph = 0;
    int underrunsAfterWarmup = -1;
    while (tCons < 120) {
        if (tProd <= tCons) {
            for (int i = 0; i < 480; ++i) {
                L[(size_t) i] = R[(size_t) i] = (float) std::sin(ph);
                ph += 2 * kPi * 1000 / 48000;
            }
            b.push(L.data(), R.data(), 480);
            tProd += 480 / prodRate;
        } else {
            b.pull(oL.data(), oR.data(), 256);
            tCons += 256 / 48000.0;
            if (underrunsAfterWarmup < 0 && tCons > 1) underrunsAfterWarmup = b.underruns.load();
        }
    }
    check(b.underruns.load() == underrunsAfterWarmup, juce::String::fromUTF8("ClockBridge: 300ppm のずれでも途切れない (underruns ") + juce::String(b.underruns.load() - underrunsAfterWarmup) + ")");
    check(b.overruns.load() == 0 && b.jumps.load() == 0, juce::String::fromUTF8("ClockBridge: あふれ・スキップなし"));
    check(std::abs(b.fillMs.load() - 40) < 15, juce::String::fromUTF8("ClockBridge: バッファ量が目標付近 (") + juce::String(b.fillMs.load(), 1) + " ms)");
    check(std::abs(b.ppm.load() - 300) < 80, juce::String::fromUTF8("ClockBridge: ずれを推定 (") + juce::String(b.ppm.load(), 0) + " ppm)");
}

int main() {
    juce::ScopedJuceInitialiser_GUI init;
    engineBasics();
    vst3Hosting();
    clockBridge();
    std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
