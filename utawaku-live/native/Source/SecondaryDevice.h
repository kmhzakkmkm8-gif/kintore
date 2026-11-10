// 2台目のオーディオデバイス（仮想ケーブル等）。伴奏の入力、または配信ミックスの出力に使う。
// メインデバイスとはクロックが別なので ClockBridge 経由で受け渡す。
#pragma once
#include "ClockBridge.h"
#include <juce_audio_devices/juce_audio_devices.h>

namespace ul {

class SecondaryDevice : private juce::AudioIODeviceCallback {
public:
    SecondaryDevice(ClockBridge& b, bool input) : bridge(b), isInput(input) {}
    ~SecondaryDevice() override { close(); }

    /** typeName: "Windows Audio" / "CoreAudio" / "ALSA" など。エラー文字列を返す（成功時は空） */
    juce::String open(juce::AudioDeviceManager& dm, const juce::String& typeName, const juce::String& deviceName, double preferredRate) {
        close();
        if (deviceName.isEmpty()) return {};
        for (auto* type : dm.getAvailableDeviceTypes()) {
            if (type->getTypeName() != typeName) continue;
            type->scanForDevices();
            std::unique_ptr<juce::AudioIODevice> d(isInput ? type->createDevice({}, deviceName) : type->createDevice(deviceName, {}));
            if (d == nullptr) return juce::String::fromUTF8("デバイスを開けません: ") + deviceName;
            juce::BigInteger ins, outs;
            (isInput ? ins : outs).setRange(0, 2, true);
            double rate = preferredRate;
            if (!d->getAvailableSampleRates().contains(rate) && !d->getAvailableSampleRates().isEmpty()) rate = d->getAvailableSampleRates()[0];
            const auto err = d->open(ins, outs, rate, juce::jmax(256, d->getDefaultBufferSize()));
            if (err.isNotEmpty()) return err;
            device = std::move(d);
            if (isInput) bridge.setProducerRate(device->getCurrentSampleRate());
            else bridge.setConsumerRate(device->getCurrentSampleRate());
            device->start(this);
            name = deviceName;
            return {};
        }
        return juce::String::fromUTF8("デバイスの種類が見つかりません: ") + typeName;
    }

    void close() {
        if (device) { device->stop(); device->close(); device.reset(); }
        name = {};
    }

    bool isOpen() const { return device != nullptr; }
    juce::String getName() const { return name; }

private:
    void audioDeviceIOCallbackWithContext(const float* const* in, int numIn, float* const* out, int numOut, int n,
                                          const juce::AudioIODeviceCallbackContext&) override {
        if (isInput) {
            if (numIn > 0 && in[0]) bridge.push(in[0], numIn > 1 && in[1] ? in[1] : in[0], n);
            for (int c = 0; c < numOut; ++c) if (out[c]) juce::FloatVectorOperations::clear(out[c], n);
        } else {
            if (numOut >= 2 && out[0] && out[1]) bridge.pull(out[0], out[1], n);
            else if (numOut == 1 && out[0]) {
                tmp.resize((size_t) n);
                bridge.pull(out[0], tmp.data(), n);
            }
            for (int c = 2; c < numOut; ++c) if (out[c]) juce::FloatVectorOperations::clear(out[c], n);
        }
    }
    void audioDeviceAboutToStart(juce::AudioIODevice*) override { bridge.requestReset(); }
    void audioDeviceStopped() override {}

    ClockBridge& bridge;
    const bool isInput;
    std::unique_ptr<juce::AudioIODevice> device;
    juce::String name;
    std::vector<float> tmp;
};

} // namespace ul
