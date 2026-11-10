// VST3 / AU プラグインのインサートチェーン（1チェーン最大6スロット）
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <array>
#include <atomic>

namespace ul {

class PluginChain {
public:
    static constexpr int kSlots = 6;

    explicit PluginChain(juce::String chainName) : name(std::move(chainName)) {}

    const juce::String name;

    /** オーディオデバイス開始時（ロックを取ってすべて準備） */
    void prepare(double sampleRate, int maxBlock);
    void release();

    /** オーディオスレッド。L/R をインプレースで処理 */
    void process(float* L, float* R, int n);

    // ---- メッセージスレッド
    /** 読み込み済みインスタンスを差し込む。古いインスタンスを返す（呼び出し側で破棄） */
    std::unique_ptr<juce::AudioPluginInstance> setPlugin(int slot, std::unique_ptr<juce::AudioPluginInstance> p);
    std::unique_ptr<juce::AudioPluginInstance> removePlugin(int slot) { return setPlugin(slot, nullptr); }
    juce::AudioPluginInstance* get(int slot) const { return slots[(size_t) slot].plugin.get(); }
    bool isBypassed(int slot) const { return slots[(size_t) slot].bypass.load(); }
    void setBypassed(int slot, bool b) { slots[(size_t) slot].bypass.store(b); }
    void moveSlot(int from, int to);
    int numLoaded() const;

    /** 合計レイテンシ（サンプル）。メッセージスレッドで定期的に updateLatency() を呼ぶ */
    int latencySamples() const { return latency.load(); }
    void updateLatency();

    std::unique_ptr<juce::XmlElement> toXml() const;
    /** XML からの復元は非同期（AU 等）なので、ロードは呼び出し側（PluginHost）が行う */

    double getSampleRate() const { return sampleRate; }
    int getBlockSize() const { return blockSize; }

private:
    struct Slot {
        std::unique_ptr<juce::AudioPluginInstance> plugin;
        std::atomic<bool> bypass { false };
        juce::AudioBuffer<float> scratch;
        int numCh = 2;
    };
    void prepareSlot(Slot& s);

    juce::CriticalSection lock;
    std::array<Slot, kSlots> slots;
    double sampleRate = 0;
    int blockSize = 0;
    juce::MidiBuffer midi;
    std::atomic<int> latency { 0 };
};

/** プラグインの事前設定：メインバスのみ、可能ならステレオ入出力 */
void configurePluginBuses(juce::AudioPluginInstance& p);

} // namespace ul
