#include "PluginChain.h"

namespace ul {

void configurePluginBuses(juce::AudioPluginInstance& p) {
    p.disableNonMainBuses();
    juce::AudioProcessor::BusesLayout stereo;
    if (p.getBusCount(true) > 0) stereo.inputBuses.add(juce::AudioChannelSet::stereo());
    if (p.getBusCount(false) > 0) stereo.outputBuses.add(juce::AudioChannelSet::stereo());
    if (p.checkBusesLayoutSupported(stereo)) p.setBusesLayout(stereo);
}

void PluginChain::prepareSlot(Slot& s) {
    if (s.plugin == nullptr || sampleRate <= 0) return;
    auto& p = *s.plugin;
    p.setRateAndBufferSizeDetails(sampleRate, blockSize);
    p.prepareToPlay(sampleRate, blockSize);
    s.numCh = juce::jmax(2, p.getTotalNumInputChannels(), p.getTotalNumOutputChannels());
    s.scratch.setSize(s.numCh, blockSize, false, true, false);
}

void PluginChain::prepare(double sr, int maxBlock) {
    const juce::ScopedLock sl(lock);
    sampleRate = sr;
    blockSize = maxBlock;
    midi.ensureSize(256);
    for (auto& s : slots) {
        if (s.plugin) s.plugin->releaseResources();
        prepareSlot(s);
    }
}

void PluginChain::release() {
    const juce::ScopedLock sl(lock);
    for (auto& s : slots)
        if (s.plugin) s.plugin->releaseResources();
}

void PluginChain::process(float* L, float* R, int n) {
    const juce::ScopedTryLock sl(lock);
    if (!sl.isLocked() || n > blockSize) return; // 差し替え中の1ブロックだけ素通し
    for (auto& s : slots) {
        if (s.plugin == nullptr) continue;
        auto& p = *s.plugin;
        float* const* ch = s.scratch.getArrayOfWritePointers();
        std::copy(L, L + n, ch[0]);
        std::copy(R, R + n, ch[1]);
        for (int c = 2; c < s.numCh; ++c) juce::FloatVectorOperations::clear(ch[c], n);
        juce::AudioBuffer<float> buf(ch, s.numCh, n);
        midi.clear();
        if (s.bypass.load()) p.processBlockBypassed(buf, midi);
        else p.processBlock(buf, midi);
        const int outs = p.getTotalNumOutputChannels();
        std::copy(ch[0], ch[0] + n, L);
        std::copy(outs >= 2 ? ch[1] : ch[0], (outs >= 2 ? ch[1] : ch[0]) + n, R);
    }
}

std::unique_ptr<juce::AudioPluginInstance> PluginChain::setPlugin(int slot, std::unique_ptr<juce::AudioPluginInstance> p) {
    if (slot < 0 || slot >= kSlots) return p;
    Slot staging;
    if (p != nullptr) {
        configurePluginBuses(*p);
        staging.plugin = std::move(p);
        prepareSlot(staging); // ロック外で準備（重い処理）
    }
    {
        const juce::ScopedLock sl(lock);
        auto& s = slots[(size_t) slot];
        std::swap(s.plugin, staging.plugin);
        std::swap(s.scratch, staging.scratch);
        std::swap(s.numCh, staging.numCh);
        s.bypass.store(false);
    }
    if (staging.plugin) staging.plugin->releaseResources();
    updateLatency();
    return std::move(staging.plugin);
}

void PluginChain::moveSlot(int from, int to) {
    if (from == to || from < 0 || to < 0 || from >= kSlots || to >= kSlots) return;
    const juce::ScopedLock sl(lock);
    auto& a = slots[(size_t) from];
    auto& b = slots[(size_t) to];
    std::swap(a.plugin, b.plugin);
    std::swap(a.scratch, b.scratch);
    std::swap(a.numCh, b.numCh);
    const bool ba = a.bypass.load();
    a.bypass.store(b.bypass.load());
    b.bypass.store(ba);
}

int PluginChain::numLoaded() const {
    int n = 0;
    for (auto& s : slots) n += s.plugin != nullptr;
    return n;
}

void PluginChain::updateLatency() {
    int total = 0;
    for (auto& s : slots)
        if (s.plugin) total += s.plugin->getLatencySamples();
    latency.store(total);
}

std::unique_ptr<juce::XmlElement> PluginChain::toXml() const {
    auto xml = std::make_unique<juce::XmlElement>("Chain");
    xml->setAttribute("name", name);
    for (int i = 0; i < kSlots; ++i) {
        auto& s = slots[(size_t) i];
        if (s.plugin == nullptr) continue;
        auto* e = xml->createNewChildElement("Slot");
        e->setAttribute("index", i);
        e->setAttribute("bypass", s.bypass.load());
        e->addChildElement(s.plugin->getPluginDescription().createXml().release());
        juce::MemoryBlock mb;
        s.plugin->getStateInformation(mb);
        e->createNewChildElement("State")->addTextElement(mb.toBase64Encoding());
    }
    return xml;
}

} // namespace ul
