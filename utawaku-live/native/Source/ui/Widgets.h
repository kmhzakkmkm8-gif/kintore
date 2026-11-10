// GUI 部品（パラメータ行・モジュールパネル・プラグインスロット・メーター）
#pragma once
#include "../MixerEngine.h"
#include "../PluginHost.h"
#include <juce_gui_extra/juce_gui_extra.h>

namespace ul {

namespace colours {
const juce::Colour bg(0xff0f1115), panel(0xff171a21), panel2(0xff1e222b), line(0xff2a2f3a), text(0xffe8eaf0), muted(0xff8b93a7),
    accent(0xffff4f8b), accent2(0xff5ad1ff), ok(0xff3ddc97), warn(0xffffc857), bad(0xffff5a5a);
}

inline juce::String u8(const char* s) { return juce::String::fromUTF8(s); }

class UlLookAndFeel : public juce::LookAndFeel_V4 {
public:
    UlLookAndFeel();
    void drawLinearSlider(juce::Graphics&, int x, int y, int w, int h, float pos, float minPos, float maxPos, juce::Slider::SliderStyle, juce::Slider&) override;
    void drawToggleButton(juce::Graphics&, juce::ToggleButton&, bool highlighted, bool down) override;
};

/** パラメータ1行（スライダー / トグル / 選択） */
class ParamRow : public juce::Component {
public:
    ParamRow(MixerEngine& e, int paramId);
    void resized() override;
    void sync();
    void setChoices(const juce::StringArray& items);
    const int id;
private:
    MixerEngine& engine;
    juce::Label label;
    juce::Slider slider;
    juce::ToggleButton toggle;
    juce::ComboBox combo;
};

/** プラグインスロット1行 */
class SlotRow : public juce::Component {
public:
    SlotRow(MixerEngine& e, PluginHost& h, int chain, int slot);
    void resized() override;
    void sync();
private:
    MixerEngine& engine;
    PluginHost& host;
    const int chain, slot;
    juce::TextButton name, edit;
    juce::ToggleButton bypass;
};

/** 折りたたみ可能なモジュール */
class ModulePanel : public juce::Component {
public:
    ModulePanel(const GroupDef& g, MixerEngine& e, PluginHost& h);
    int preferredHeight() const;
    void resized() override;
    void paint(juce::Graphics&) override;
    void sync();
    void setBadge(const juce::String& s) { badge.setText(s, juce::dontSendNotification); }
    void addExtra(juce::Component* c) { extras.add(c); addAndMakeVisible(c); }
    ParamRow* findRow(int paramId);
    const GroupDef group;
    std::function<void()> onLayoutChanged;
private:
    juce::TextButton header;
    juce::Label badge;
    juce::OwnedArray<ParamRow> rows;
    juce::OwnedArray<SlotRow> slots;
    juce::OwnedArray<juce::Component> extras;
    bool open;
};

/** 横長のレベルメーター（ピークホールド付き） */
class Meter : public juce::Component {
public:
    explicit Meter(int channels = 1) : ch(channels) {}
    void push(float a, float b = 0) { lv[0] = juce::jmax(a, lv[0] * 0.82f); lv[1] = juce::jmax(b, lv[1] * 0.82f); repaint(); }
    void paint(juce::Graphics&) override;
private:
    int ch;
    float lv[2] { 0, 0 };
};

} // namespace ul
