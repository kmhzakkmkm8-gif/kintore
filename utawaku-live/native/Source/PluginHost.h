// プラグインのスキャン・読み込み・エディタウィンドウ・状態保存
#pragma once
#include "MixerEngine.h"
#include <juce_audio_utils/juce_audio_utils.h>

namespace ul {

class PluginHost : public juce::ChangeListener {
public:
    PluginHost(MixerEngine& e, juce::PropertiesFile& props);
    ~PluginHost() override;

    juce::AudioPluginFormatManager formats;
    juce::KnownPluginList known;

    /** プラグイン管理（スキャン）ダイアログ */
    void showPluginManager(juce::Component* parent);
    /** スロットのメニュー（追加/差し替え/エディタ/外す） */
    void showSlotMenu(int chain, int slot, juce::Component* target, std::function<void()> changed);
    void loadIntoSlot(int chain, int slot, const juce::PluginDescription& d, const juce::MemoryBlock* state, bool bypass,
                      std::function<void(juce::String)> done);
    void removeSlot(int chain, int slot);
    void openEditor(int chain, int slot);
    void closeAllEditors();

    std::unique_ptr<juce::XmlElement> chainsToXml() const;
    void restoreChains(const juce::XmlElement& xml, std::function<void()> done);

    std::function<void(juce::String)> onError;

private:
    void changeListenerCallback(juce::ChangeBroadcaster*) override;
    class EditorWindow;
    MixerEngine& engine;
    juce::PropertiesFile& props;
    juce::OwnedArray<EditorWindow> editors;
    std::unique_ptr<juce::DialogWindow> managerWindow;
    juce::File deadMansPedal;
};

} // namespace ul
