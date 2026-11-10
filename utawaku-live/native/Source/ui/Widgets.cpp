#include "Widgets.h"

namespace ul {

UlLookAndFeel::UlLookAndFeel() {
    using namespace colours;
    setColour(juce::ResizableWindow::backgroundColourId, bg);
    setColour(juce::Label::textColourId, text);
    setColour(juce::TextButton::buttonColourId, panel2);
    setColour(juce::TextButton::buttonOnColourId, accent);
    setColour(juce::TextButton::textColourOffId, text);
    setColour(juce::TextButton::textColourOnId, juce::Colours::white);
    setColour(juce::ComboBox::backgroundColourId, panel2);
    setColour(juce::ComboBox::outlineColourId, line);
    setColour(juce::ComboBox::textColourId, text);
    setColour(juce::PopupMenu::backgroundColourId, panel2);
    setColour(juce::PopupMenu::highlightedBackgroundColourId, accent);
    setColour(juce::Slider::textBoxTextColourId, text);
    setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
    setColour(juce::Slider::textBoxBackgroundColourId, juce::Colours::transparentBlack);
    setColour(juce::ScrollBar::thumbColourId, line);
    setColour(juce::ListBox::backgroundColourId, panel);
    setColour(juce::TextEditor::backgroundColourId, panel2);
    setColour(juce::AlertWindow::backgroundColourId, panel);
#if JUCE_WINDOWS
    setDefaultSansSerifTypefaceName("Yu Gothic UI");
#elif JUCE_MAC
    setDefaultSansSerifTypefaceName("Hiragino Sans");
#else
    setDefaultSansSerifTypefaceName("Noto Sans CJK JP");
#endif
}

void UlLookAndFeel::drawLinearSlider(juce::Graphics& g, int x, int y, int w, int h, float pos, float, float, juce::Slider::SliderStyle, juce::Slider& s) {
    using namespace colours;
    const float cy = (float) y + (float) h * 0.5f;
    g.setColour(line);
    g.fillRoundedRectangle((float) x, cy - 2.0f, (float) w, 4.0f, 2.0f);
    const double zero = juce::jlimit(s.getMinimum(), s.getMaximum(), 0.0);
    const float zx = (float) s.getPositionOfValue(zero);
    g.setColour(accent.withAlpha(s.isEnabled() ? 1.0f : 0.4f));
    g.fillRoundedRectangle(juce::jmin(zx, pos), cy - 2.0f, std::abs(pos - zx), 4.0f, 2.0f);
    g.setColour(juce::Colours::white);
    g.fillEllipse(pos - 6.0f, cy - 6.0f, 12.0f, 12.0f);
}

void UlLookAndFeel::drawToggleButton(juce::Graphics& g, juce::ToggleButton& b, bool, bool) {
    using namespace colours;
    const auto r = b.getLocalBounds().toFloat();
    const juce::Rectangle<float> sw(r.getRight() - 38.0f, r.getCentreY() - 10.0f, 36.0f, 20.0f);
    g.setColour(b.getToggleState() ? accent : line);
    g.fillRoundedRectangle(sw, 10.0f);
    g.setColour(juce::Colours::white);
    g.fillEllipse(b.getToggleState() ? sw.getRight() - 18.0f : sw.getX() + 2.0f, sw.getY() + 2.0f, 16.0f, 16.0f);
    if (b.getButtonText().isNotEmpty()) {
        g.setColour(muted);
        g.setFont(juce::FontOptions(13.0f));
        g.drawText(b.getButtonText(), r.withTrimmedRight(44.0f), juce::Justification::centredLeft);
    }
}

// ------------------------------------------------------------------ ParamRow
ParamRow::ParamRow(MixerEngine& e, int paramId) : id(paramId), engine(e) {
    const auto& d = def(id);
    label.setText(d.label + (d.unit.isNotEmpty() && d.type == PType::Float ? "  " + d.unit : juce::String()), juce::dontSendNotification);
    label.setColour(juce::Label::textColourId, colours::muted);
    label.setFont(juce::FontOptions(13.0f));
    label.setTooltip(d.hint);
    addAndMakeVisible(label);
    for (juce::Component* c : { (juce::Component*) &slider, (juce::Component*) &toggle, (juce::Component*) &combo }) {
        c->setWantsKeyboardFocus(false);
        c->setMouseClickGrabsKeyboardFocus(false);
    }
    if (d.type == PType::Toggle) {
        addAndMakeVisible(toggle);
        toggle.onClick = [this] { engine.setParam(id, toggle.getToggleState() ? 1.0f : 0.0f); };
    } else if (d.type == PType::Choice) {
        addAndMakeVisible(combo);
        setChoices(d.choices);
        combo.onChange = [this] { if (combo.getSelectedItemIndex() >= 0) engine.setParam(id, (float) combo.getSelectedItemIndex()); };
    } else {
        addAndMakeVisible(slider);
        slider.setSliderStyle(juce::Slider::LinearHorizontal);
        slider.setTextBoxStyle(juce::Slider::TextBoxRight, false, 58, 20);
        slider.setRange(d.min, d.max, d.step);
        slider.setDoubleClickReturnValue(true, d.def);
        slider.setTooltip(d.hint.isNotEmpty() ? d.hint : u8("ダブルクリックで初期値"));
        const bool offable = d.unit == "dB" && d.min <= -60.0f;
        slider.textFromValueFunction = [offable, step = d.step](double v) {
            if (offable && v <= -60.0) return juce::String("OFF");
            return juce::String(v, step < 0.1f ? 2 : step < 1.0f ? 1 : 0);
        };
        slider.onValueChange = [this] { engine.setParam(id, (float) slider.getValue()); };
    }
    sync();
}

void ParamRow::setChoices(const juce::StringArray& items) {
    const int sel = (int) engine.getParam(id);
    combo.clear(juce::dontSendNotification);
    combo.addItemList(items, 1);
    combo.setSelectedItemIndex(sel, juce::dontSendNotification);
}

void ParamRow::resized() {
    auto r = getLocalBounds();
    label.setBounds(r.removeFromLeft(juce::jmax(110, r.getWidth() * 42 / 100)));
    if (def(id).type == PType::Toggle) toggle.setBounds(r.removeFromRight(44));
    else if (def(id).type == PType::Choice) combo.setBounds(r.reduced(0, 2));
    else slider.setBounds(r);
}

void ParamRow::sync() {
    const float v = engine.getParam(id);
    switch (def(id).type) {
        case PType::Toggle: toggle.setToggleState(v > 0.5f, juce::dontSendNotification); break;
        case PType::Choice: if (combo.getSelectedItemIndex() != (int) v) combo.setSelectedItemIndex((int) v, juce::dontSendNotification); break;
        case PType::Float: if (!slider.isMouseButtonDown() && std::abs(slider.getValue() - v) > 1e-4) slider.setValue(v, juce::dontSendNotification); break;
    }
}

// ------------------------------------------------------------------ SlotRow
SlotRow::SlotRow(MixerEngine& e, PluginHost& h, int c, int s) : engine(e), host(h), chain(c), slot(s) {
    addAndMakeVisible(name);
    addAndMakeVisible(edit);
    addAndMakeVisible(bypass);
    edit.setButtonText(u8("編集"));
    bypass.setTooltip(u8("ON = 有効 / OFF = バイパス（シーンに保存されます）"));
    for (juce::Component* x : { (juce::Component*) &name, (juce::Component*) &edit, (juce::Component*) &bypass }) {
        x->setWantsKeyboardFocus(false);
        x->setMouseClickGrabsKeyboardFocus(false);
    }
    name.onClick = [this] { host.showSlotMenu(chain, slot, &name, [this] { sync(); }); };
    edit.onClick = [this] { host.openEditor(chain, slot); };
    bypass.onClick = [this] { engine.chains[(size_t) chain]->setBypassed(slot, !bypass.getToggleState()); };
    sync();
}

void SlotRow::resized() {
    auto r = getLocalBounds().reduced(0, 2);
    bypass.setBounds(r.removeFromRight(44));
    r.removeFromRight(4);
    edit.setBounds(r.removeFromRight(48));
    r.removeFromRight(4);
    name.setBounds(r);
}

void SlotRow::sync() {
    auto* p = engine.chains[(size_t) chain]->get(slot);
    const auto text = p ? juce::String(slot + 1) + ". " + p->getName() : juce::String(slot + 1) + u8(".  ＋ VST を追加");
    if (name.getButtonText() != text) name.setButtonText(text);
    name.setColour(juce::TextButton::textColourOffId, p ? colours::text : colours::muted);
    edit.setEnabled(p != nullptr);
    bypass.setEnabled(p != nullptr);
    bypass.setToggleState(p != nullptr && !engine.chains[(size_t) chain]->isBypassed(slot), juce::dontSendNotification);
}

// ------------------------------------------------------------------ ModulePanel
ModulePanel::ModulePanel(const GroupDef& g, MixerEngine& e, PluginHost& h) : group(g), open(g.openByDefault) {
    header.setButtonText(g.title);
    header.setColour(juce::TextButton::buttonColourId, juce::Colours::transparentBlack);
    header.setWantsKeyboardFocus(false);
    header.setMouseClickGrabsKeyboardFocus(false);
    header.onClick = [this] {
        open = !open;
        for (auto* r : rows) r->setVisible(open);
        for (auto* s : slots) s->setVisible(open);
        for (auto* x : extras) x->setVisible(open);
        if (onLayoutChanged) onLayoutChanged();
    };
    addAndMakeVisible(header);
    badge.setColour(juce::Label::textColourId, colours::warn);
    badge.setJustificationType(juce::Justification::centredRight);
    badge.setFont(juce::FontOptions(juce::Font::getDefaultMonospacedFontName(), 12.0f, juce::Font::plain));
    badge.setInterceptsMouseClicks(false, false);
    addAndMakeVisible(badge);
    for (auto& p : paramDefs())
        if (p.group == g.id) addChildComponent(rows.add(new ParamRow(e, p.index)));
    if (g.chain >= 0)
        for (int s = 0; s < PluginChain::kSlots; ++s) addChildComponent(slots.add(new SlotRow(e, h, g.chain, s)));
    for (auto* r : rows) r->setVisible(open);
    for (auto* s : slots) s->setVisible(open);
}

ParamRow* ModulePanel::findRow(int paramId) {
    for (auto* r : rows)
        if (r->id == paramId) return r;
    return nullptr;
}

int ModulePanel::preferredHeight() const {
    if (!open) return 30;
    return 30 + rows.size() * 26 + slots.size() * 28 + extras.size() * 28 + 8;
}

void ModulePanel::resized() {
    auto r = getLocalBounds();
    auto top = r.removeFromTop(30);
    badge.setBounds(top.removeFromRight(110).reduced(8, 0));
    header.setBounds(top);
    r = r.reduced(10, 0);
    for (auto* x : rows) x->setBounds(r.removeFromTop(26));
    for (auto* x : slots) x->setBounds(r.removeFromTop(28));
    for (auto* x : extras) x->setBounds(r.removeFromTop(28).reduced(0, 2));
}

void ModulePanel::paint(juce::Graphics& g) {
    g.setColour(colours::panel);
    g.fillRoundedRectangle(getLocalBounds().toFloat(), 8.0f);
    g.setColour(colours::line);
    g.drawRoundedRectangle(getLocalBounds().toFloat().reduced(0.5f), 8.0f, 1.0f);
    g.setColour(colours::muted);
    g.setFont(juce::FontOptions(11.0f));
    g.drawText(open ? juce::CharPointer_UTF8("\xe2\x96\xbe") : juce::CharPointer_UTF8("\xe2\x96\xb8"), 4, 0, 12, 30, juce::Justification::centred);
}

void ModulePanel::sync() {
    if (!open) return;
    for (auto* r : rows) r->sync();
    for (auto* s : slots) s->sync();
}

// ------------------------------------------------------------------ Meter
void Meter::paint(juce::Graphics& g) {
    using namespace colours;
    auto r = getLocalBounds().toFloat();
    g.setColour(juce::Colour(0xff0a0b0e));
    g.fillRoundedRectangle(r, 3.0f);
    const float h = r.getHeight() / (float) ch;
    for (int c = 0; c < ch; ++c) {
        const float db = lv[c] > 1e-6f ? 20.0f * std::log10(lv[c]) : -120.0f;
        const float pos = juce::jlimit(0.0f, 1.0f, (db + 60.0f) / 60.0f);
        g.setColour(db > -1.0f ? bad : db > -9.0f ? warn : ok);
        g.fillRect(r.getX(), r.getY() + h * (float) c + 1.0f, r.getWidth() * pos, h - 2.0f);
    }
    g.setColour(juce::Colours::white.withAlpha(0.2f));
    for (float db : { -48.0f, -36.0f, -24.0f, -12.0f, -6.0f }) g.fillRect(r.getX() + r.getWidth() * (db + 60.0f) / 60.0f, r.getY(), 1.0f, r.getHeight());
}

} // namespace ul
