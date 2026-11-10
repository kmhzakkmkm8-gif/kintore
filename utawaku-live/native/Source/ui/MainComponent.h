#pragma once
#include "../BrowserBridge.h"
#include "../SecondaryDevice.h"
#include "Widgets.h"

namespace ul {

class MainComponent : public juce::Component,
                      private juce::Timer,
                      private juce::ChangeListener,
                      private juce::MidiInputCallback {
public:
    explicit MainComponent(juce::PropertiesFile& settings);
    ~MainComponent() override;

    void paint(juce::Graphics&) override;
    void resized() override;
    bool keyPressed(const juce::KeyPress&) override;
    bool keyStateChanged(bool isKeyDown) override;
    void mouseDown(const juce::MouseEvent&) override;
    void parentHierarchyChanged() override { if (isShowing()) grabKeyboardFocus(); }

    void saveState();

private:
    void timerCallback() override;
    void changeListenerCallback(juce::ChangeBroadcaster*) override;
    void handleIncomingMidiMessage(juce::MidiInput*, const juce::MidiMessage&) override;

    void buildColumns();
    void layoutColumns();
    void refreshRouting();
    void applyMusicSource();
    void applyStreamOut();
    void recallScene(int i);
    void storeScene(int i);
    void renderScenes();
    void tap();
    void toggleRecord();
    void exportPreset();
    void importPreset();
    void loadState();
    std::unique_ptr<juce::XmlElement> stateToXml(bool includeRouting) const;
    void applyStateXml(const juce::XmlElement& xml, bool includeRouting);
    void showError(const juce::String& msg);
    void setStatusMessage(const juce::String& msg);
    void renameScene(int i);
    juce::String secondaryTypeName();

    juce::PropertiesFile& settings;
    UlLookAndFeel lnf;
    juce::AudioDeviceManager deviceManager;
    MixerEngine engine;
    PluginHost host;
    BrowserBridge bridge;
    SecondaryDevice secIn, secOut;

    // ヘッダー
    juce::Label title, status;
    juce::TextButton btnAudio, btnPlugins, btnRec, btnPanic, btnPreset;
    // ルーティング
    juce::Label lblSource, lblMon, lblStream, sourceInfo;
    juce::ComboBox cbSource, cbSourceDetail, cbMonOut, cbStreamOut;
    juce::TextButton btnOpenPage, btnFile, btnPlay;
    std::unique_ptr<juce::FileChooser> chooser;
    // シーン
    juce::OwnedArray<juce::TextButton> sceneButtons;
    juce::TextButton btnTap, btnThrow;
    std::vector<Scene> scenes;
    int activeScene = 0;
    // ミキサー
    juce::Viewport viewport;
    juce::Component content;
    struct Column { juce::String strip, title; std::unique_ptr<juce::Label> label; std::unique_ptr<Meter> meter; std::vector<ModulePanel*> panels; };
    std::vector<Column> columns;
    juce::OwnedArray<ModulePanel> panels;
    juce::Label loudM, loudS, loudI, loudNote;
    juce::TextButton btnLoudReset, btnLatencyAuto, btnRelearn;
    juce::TooltipWindow tooltips { this, 600 };

    std::vector<double> taps;
    bool throwKeyDown = false;
    int saveCountdown = 0;
    juce::uint32 statusHoldUntil = 0;
    std::unique_ptr<juce::AlertWindow> renameWindow;
    juce::StringArray secTypeDevicesIn, secTypeDevicesOut;
};

} // namespace ul
