// テスト用の最小 VST3：-6dB のゲインと 64 サンプルの遅延（レイテンシ補正の検証用）
#include <juce_audio_processors/juce_audio_processors.h>

class TestGain : public juce::AudioProcessor {
public:
    TestGain() : AudioProcessor(BusesProperties().withInput("In", juce::AudioChannelSet::stereo()).withOutput("Out", juce::AudioChannelSet::stereo())) {
        setLatencySamples(64);
    }
    void prepareToPlay(double, int) override {
        for (auto& d : dl) d.assign(64, 0.0f);
        pos = 0;
    }
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>& b, juce::MidiBuffer&) override {
        for (int i = 0; i < b.getNumSamples(); ++i) {
            for (int c = 0; c < juce::jmin(2, b.getNumChannels()); ++c) {
                const float x = b.getSample(c, i);
                b.setSample(c, i, dl[(size_t) c][(size_t) pos] * 0.5f);
                dl[(size_t) c][(size_t) pos] = x;
            }
            pos = (pos + 1) % 64;
        }
    }
    bool isBusesLayoutSupported(const BusesLayout& l) const override {
        return l.getMainOutputChannelSet() == juce::AudioChannelSet::stereo() && l.getMainInputChannelSet() == l.getMainOutputChannelSet();
    }
    juce::AudioProcessorEditor* createEditor() override { return new juce::GenericAudioProcessorEditor(*this); }
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "UL Test Gain"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock& m) override { m.append("ulgain", 6); }
    void setStateInformation(const void*, int) override {}

private:
    std::array<std::vector<float>, 2> dl;
    int pos = 0;
};

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TestGain(); }
