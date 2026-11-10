#include "PluginHost.h"

namespace ul {

class PluginHost::EditorWindow : public juce::DocumentWindow {
public:
    EditorWindow(PluginHost& h, int c, int s, juce::AudioPluginInstance& p)
        : juce::DocumentWindow(p.getName(), juce::Colour(0xff171a21), juce::DocumentWindow::closeButton), host(h), chain(c), slot(s) {
        setUsingNativeTitleBar(true);
        auto* ed = p.createEditorIfNeeded();
        if (ed == nullptr) ed = new juce::GenericAudioProcessorEditor(p);
        setContentOwned(ed, true);
        setResizable(ed->isResizable(), false);
        setAlwaysOnTop(false);
        centreWithSize(getWidth(), getHeight());
        setVisible(true);
    }
    ~EditorWindow() override { clearContentComponent(); }
    void closeButtonPressed() override { host.editors.removeObject(this); }
    PluginHost& host;
    const int chain, slot;
};

PluginHost::PluginHost(MixerEngine& e, juce::PropertiesFile& p) : engine(e), props(p) {
    formats.addDefaultFormats();
    if (auto xml = props.getXmlValue("knownPlugins")) known.recreateFromXml(*xml);
    known.addChangeListener(this);
    deadMansPedal = props.getFile().getSiblingFile("plugin-scan-crash.txt");
}

PluginHost::~PluginHost() {
    known.removeChangeListener(this);
    closeAllEditors();
}

void PluginHost::changeListenerCallback(juce::ChangeBroadcaster*) {
    if (auto xml = known.createXml()) props.setValue("knownPlugins", xml.get());
    props.saveIfNeeded();
}

void PluginHost::showPluginManager(juce::Component* parent) {
    auto* list = new juce::PluginListComponent(formats, known, deadMansPedal, &props, true);
    list->setSize(760, 520);
    juce::DialogWindow::LaunchOptions o;
    o.content.setOwned(list);
    o.dialogTitle = juce::String::fromUTF8("プラグイン管理（「オプション」→「スキャン」で VST3 を検出）");
    o.dialogBackgroundColour = juce::Colour(0xff171a21);
    o.componentToCentreAround = parent;
    o.useNativeTitleBar = true;
    o.resizable = true;
    o.launchAsync();
}

void PluginHost::closeAllEditors() { editors.clear(); }

void PluginHost::openEditor(int chain, int slot) {
    for (auto* w : editors)
        if (w->chain == chain && w->slot == slot) { w->toFront(true); return; }
    if (auto* p = engine.chains[(size_t) chain]->get(slot)) editors.add(new EditorWindow(*this, chain, slot, *p));
}

void PluginHost::removeSlot(int chain, int slot) {
    for (int i = editors.size(); --i >= 0;)
        if (editors[i]->chain == chain && editors[i]->slot == slot) editors.remove(i);
    auto old = engine.chains[(size_t) chain]->removePlugin(slot);
    old.reset();
}

void PluginHost::loadIntoSlot(int chain, int slot, const juce::PluginDescription& d, const juce::MemoryBlock* state, bool bypass,
                              std::function<void(juce::String)> done) {
    auto& c = *engine.chains[(size_t) chain];
    const double sr = c.getSampleRate() > 0 ? c.getSampleRate() : 48000.0;
    const int bs = c.getBlockSize() > 0 ? c.getBlockSize() : 512;
    std::shared_ptr<juce::MemoryBlock> st = state ? std::make_shared<juce::MemoryBlock>(*state) : nullptr;
    formats.createPluginInstanceAsync(d, sr, bs, [this, chain, slot, st, bypass, done, name = d.name](std::unique_ptr<juce::AudioPluginInstance> inst, const juce::String& err) {
        if (inst == nullptr) {
            if (done) done(name + ": " + (err.isNotEmpty() ? err : juce::String::fromUTF8("読み込みに失敗しました")));
            return;
        }
        if (st) inst->setStateInformation(st->getData(), (int) st->getSize());
        for (int i = editors.size(); --i >= 0;)
            if (editors[i]->chain == chain && editors[i]->slot == slot) editors.remove(i);
        auto old = engine.chains[(size_t) chain]->setPlugin(slot, std::move(inst));
        engine.chains[(size_t) chain]->setBypassed(slot, bypass);
        old.reset();
        if (done) done({});
    });
}

void PluginHost::showSlotMenu(int chain, int slot, juce::Component* target, std::function<void()> changed) {
    auto& c = *engine.chains[(size_t) chain];
    juce::PopupMenu m;
    const auto types = known.getTypes();
    juce::PopupMenu plugins;
    juce::KnownPluginList::addToMenu(plugins, types, juce::KnownPluginList::sortByManufacturer);
    const bool has = c.get(slot) != nullptr;
    if (has) {
        m.addItem(-1, juce::String::fromUTF8("エディタを開く"));
        m.addItem(-2, juce::String::fromUTF8("外す"));
        if (slot > 0) m.addItem(-4, juce::String::fromUTF8("ひとつ上へ"));
        if (slot < PluginChain::kSlots - 1) m.addItem(-5, juce::String::fromUTF8("ひとつ下へ"));
        m.addSeparator();
    }
    if (types.isEmpty()) m.addItem(-3, juce::String::fromUTF8("プラグインをスキャン…（未登録）"));
    else {
        m.addSubMenu(has ? juce::String::fromUTF8("差し替え") : juce::String::fromUTF8("プラグインを追加"), plugins);
        m.addItem(-3, juce::String::fromUTF8("プラグイン管理 / 再スキャン…"));
    }
    juce::Component::SafePointer<juce::Component> safe(target);
    m.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(target), [this, chain, slot, types, changed, safe](int r) {
        auto& ch = *engine.chains[(size_t) chain];
        if (r == 0) return;
        if (r == -1) openEditor(chain, slot);
        else if (r == -2) removeSlot(chain, slot);
        else if (r == -3) showPluginManager(safe.getComponent() ? safe->getTopLevelComponent() : nullptr);
        else if (r == -4 || r == -5) {
            closeAllEditors();
            ch.moveSlot(slot, r == -4 ? slot - 1 : slot + 1);
        } else {
            const int idx = juce::KnownPluginList::getIndexChosenByMenu(types, r);
            if (idx >= 0)
                loadIntoSlot(chain, slot, types.getReference(idx), nullptr, false, [this, chain, slot, changed](juce::String err) {
                    if (err.isNotEmpty() && onError) onError(err);
                    else openEditor(chain, slot);
                    if (changed) changed();
                });
        }
        if (changed) changed();
    });
}

std::unique_ptr<juce::XmlElement> PluginHost::chainsToXml() const {
    auto xml = std::make_unique<juce::XmlElement>("Chains");
    for (auto& c : engine.chains) xml->addChildElement(c->toXml().release());
    return xml;
}

void PluginHost::restoreChains(const juce::XmlElement& xml, std::function<void()> done) {
    closeAllEditors();
    for (int ci = 0; ci < kNumChains; ++ci)
        for (int s = 0; s < PluginChain::kSlots; ++s) engine.chains[(size_t) ci]->removePlugin(s).reset();
    auto pending = std::make_shared<int>(0);
    for (auto* ce : xml.getChildWithTagNameIterator("Chain")) {
        int ci = -1;
        for (int i = 0; i < kNumChains; ++i)
            if (engine.chains[(size_t) i]->name == ce->getStringAttribute("name")) ci = i;
        if (ci < 0) continue;
        for (auto* se : ce->getChildWithTagNameIterator("Slot")) {
            juce::PluginDescription d;
            auto* de = se->getChildByName("PLUGIN");
            if (de == nullptr || !d.loadFromXml(*de)) continue;
            juce::MemoryBlock mb;
            if (auto* st = se->getChildByName("State")) mb.fromBase64Encoding(st->getAllSubText());
            ++*pending;
            loadIntoSlot(ci, se->getIntAttribute("index"), d, &mb, se->getBoolAttribute("bypass"), [this, pending, done, name = d.name](juce::String err) {
                if (err.isNotEmpty() && onError) onError(juce::String::fromUTF8("復元できませんでした: ") + err);
                if (--*pending == 0 && done) done();
            });
        }
    }
    if (*pending == 0 && done) done();
}

} // namespace ul
