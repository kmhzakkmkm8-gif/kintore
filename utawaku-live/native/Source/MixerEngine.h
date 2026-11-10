// 音声エンジン：オーディオデバイスのコールバックで、ボーカル・伴奏・FX・マスター・モニターをすべて処理する。
#pragma once
#include "ClockBridge.h"
#include "PluginChain.h"
#include "Params.h"
#include "dsp/Dsp.h"
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_dsp/juce_dsp.h>

namespace ul {

enum class MusicSource : int { none = 0, browser, deviceInputs, secondaryDevice, file };
constexpr int kOutSecondary = -2; // 配信出力：別デバイス
constexpr int kOutNone = -1;

struct Meters {
    std::atomic<float> vocalIn { 0 }, vocalOut { 0 }, musicL { 0 }, musicR { 0 }, masterL { 0 }, masterR { 0 }, monitor { 0 };
    std::atomic<float> lufsM { -INFINITY }, lufsS { -INFINITY }, lufsI { -INFINITY };
    std::atomic<float> grGate { 0 }, grC1 { 0 }, grDs { 0 }, grC2 { 0 }, riderDb { 0 }, carveDb { 0 }, throwAmt { 0 };
    std::atomic<float> agLufs { -INFINITY }, agGain { 0 }, grGlue { 0 }, grLim { 0 };
    std::atomic<bool> clip { false };
    std::atomic<int> throwTriggers { 0 };
    std::atomic<float> cpu { 0 };
    static void maxInto(std::atomic<float>& a, float v) {
        float cur = a.load();
        while (v > cur && !a.compare_exchange_weak(cur, v)) {}
    }
};

class MixerEngine : public juce::AudioIODeviceCallback, private juce::Timer {
public:
    MixerEngine();
    ~MixerEngine() override;

    // ---- パラメータ（どのスレッドからでも）
    void setParam(int id, float value, float rampSeconds = 0.03f);
    float getParam(int id) const { return target[(size_t) id].load(); }

    // ---- ルーティング
    std::atomic<int> musicSource { (int) MusicSource::browser };
    std::atomic<int> musicInputCh { 2 };     // deviceInputs のときの開始チャンネル
    std::atomic<int> monitorOutCh { 0 };     // モニター出力の開始チャンネル
    std::atomic<int> streamOutCh { kOutNone };

    ClockBridge browserBridge, secondaryInBridge, secondaryOutBridge;
    std::array<std::unique_ptr<PluginChain>, kNumChains> chains;
    Meters meters;

    // ---- ファイル再生（伴奏）
    juce::AudioFormatManager formatManager;
    bool loadMusicFile(const juce::File& f);
    juce::AudioTransportSource transport;
    juce::String musicFileName;

    // ---- 操作
    void throwManual(bool on) { manualThrow.store(on ? 1.0f : 0.0f); }
    void panic(bool on) { panicked.store(on); }
    bool isPanicked() const { return panicked.load(); }
    void resetLoudness() { loudReset.store(true); }
    void relearnMusic() { agRelearn.store(true); }
    bool startRecording(const juce::File& f);
    void stopRecording();
    bool isRecording() const { return writerActive.load(); }
    juce::File getRecordingFile() const { return recordingFile; }

    // ---- 情報
    double getSampleRate() const { return sampleRate; }
    int getBlockSize() const { return blockSize; }
    int vocalPluginLatency() const { return chains[chainVocal]->latencySamples(); }
    double currentDelaySeconds() const { return delaySeconds.load(); }

    // ---- オフライン処理（テスト用）・デバイスコールバック
    void prepare(double sr, int maxBlock);
    void process(const float* const* in, int numIn, float* const* out, int numOut, int n);

    void audioDeviceIOCallbackWithContext(const float* const* in, int numIn, float* const* out, int numOut, int n,
                                          const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart(juce::AudioIODevice* d) override;
    void audioDeviceStopped() override;

    /** IR 更新をすぐに反映（テスト用） */
    void updateReverbNow();

private:
    void timerCallback() override;
    void processChunk(const float* const* in, int numIn, float* const* out, int numOut, int n);
    void updateParams(int n);
    float cur(int id) const { return current[(size_t) id]; }

    std::array<std::atomic<float>, kNumParams> target;
    std::array<std::atomic<float>, kNumParams> ramp;
    std::array<float, kNumParams> current {};

    double sampleRate = 48000;
    int blockSize = 512;
    std::atomic<bool> prepared { false };
    juce::CriticalSection prepareLock;

    // ボーカル
    SmartBiquad hpf, eqLo, eqM1, eqM2, eqHi;
    Expander gate; Compressor c1, c2; DeEsser ds; Saturator sat; VocalRider rider;
    // FX
    DelayLine revPreDelay, capture, dA, dB, dL, dR, dblL, dblR;
    SmartBiquad revHP, revLP, dHP, dLP, loopLP, dblHP;
    PhraseThrow throwDet;
    juce::dsp::Convolution conv;
    double lfo1 = 0, lfo2 = 0;
    // 伴奏
    AutoGain autogain;
    std::array<SmartBiquad, 2> mLowcutF, mLoF, mHiF, carveF;
    std::array<DelayLine, 2> compDelay;
    CarveControl carve;
    // マスター
    Compressor glue; LookaheadLimiter limiter; LoudnessMeter loud;
    int loudCounter = 0;

    // スムージングされたゲイン（ブロック内で線形補間）
    struct Ramp {
        float prev = 0, next = 0;
        void set(float v, bool jump = false) { prev = jump ? v : next; next = v; }
        inline float at(int i, int n) const { return prev + (next - prev) * (float) (i + 1) / (float) n; }
    };
    Ramp gTrim, gFader, gRevSend, gRevRet, gDlySend, gDlyRet, gThrowAmt, gThrowRev, gDblSend, gMTrim, gMFader,
        gDrive, gMonVocal, gMonMusic, gMonFx, gMonLevel, gStream, gManual;
    double compDelaySmoothed = 0, delayTSmoothed = 0.375, revPreSmoothed = 0;
    bool firstBlock = true;

    // 作業バッファ
    juce::AudioBuffer<float> vMono, vPre, vSt, mBuf, mPre, mPost, revBuf, dlyBuf, dblBuf, fx, master, monitor, fileBuf;

    std::atomic<float> manualThrow { 0 };
    std::atomic<bool> panicked { false }, loudReset { false }, agRelearn { false };
    std::atomic<double> delaySeconds { 0.375 };

    // リバーブ IR の再生成（メッセージスレッド）
    float irDecay = -1, irType = -1;
    juce::uint32 irChangedAt = 0;

    // ファイル再生
    std::unique_ptr<juce::AudioFormatReaderSource> readerSource;
    juce::TimeSliceThread readAheadThread { "UL read-ahead" };

    // 録音
    juce::TimeSliceThread writerThread { "UL recorder" };
    std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> writer;
    juce::CriticalSection writerLock;
    std::atomic<bool> writerActive { false };
    juce::File recordingFile;

    juce::AudioProcessLoadMeasurer load;
};

} // namespace ul
