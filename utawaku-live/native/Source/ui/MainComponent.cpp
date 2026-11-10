#include "MainComponent.h"

namespace ul {

namespace {
constexpr int kBridgePort = 5181;
enum SourceItem { srcNone = 1, srcBrowser, srcDeviceIn, srcSecondary, srcFile };

void noFocus(juce::Component& c) {
    c.setWantsKeyboardFocus(false);
    c.setMouseClickGrabsKeyboardFocus(false);
}

juce::String fmtGr(float g) { return g < 0.05f ? juce::String("0.0 dB") : "-" + juce::String(g, 1) + " dB"; }
juce::String fmtLufs(float v) { return std::isfinite(v) ? juce::String(v, 1) : juce::String(juce::CharPointer_UTF8("\xe2\x80\x94")); }
} // namespace

MainComponent::MainComponent(juce::PropertiesFile& s)
    : settings(s), host(engine, s), bridge(engine.browserBridge, kBridgePort), secIn(engine.secondaryInBridge, true), secOut(engine.secondaryOutBridge, false) {
    setLookAndFeel(&lnf);
    juce::LookAndFeel::setDefaultLookAndFeel(&lnf);
    setWantsKeyboardFocus(true);
    host.onError = [this](juce::String m) { showError(m); };

    // ---- ヘッダー
    title.setText(u8("UTAWAKU LIVE"), juce::dontSendNotification);
    title.setFont(juce::FontOptions(18.0f, juce::Font::bold));
    title.setColour(juce::Label::textColourId, colours::accent);
    status.setColour(juce::Label::textColourId, colours::muted);
    status.setFont(juce::FontOptions(12.5f));
    for (auto* l : { &title, &status }) addAndMakeVisible(l);
    btnAudio.setButtonText(u8("オーディオ設定"));
    btnPlugins.setButtonText(u8("プラグイン管理"));
    btnPreset.setButtonText(u8("プリセット"));
    btnRec.setButtonText(u8("● 録音"));
    btnPanic.setButtonText("PANIC");
    btnPanic.setTooltip(u8("Esc：配信とモニターを即ミュート"));
    for (auto* b : { &btnAudio, &btnPlugins, &btnPreset, &btnRec, &btnPanic }) { addAndMakeVisible(b); noFocus(*b); }
    btnAudio.onClick = [this] {
        auto* sel = new juce::AudioDeviceSelectorComponent(deviceManager, 1, 32, 2, 32, true, false, false, false);
        sel->setSize(560, 460);
        juce::DialogWindow::LaunchOptions o;
        o.content.setOwned(sel);
        o.dialogTitle = u8("オーディオ設定（ASIO / WASAPI / CoreAudio・バッファは 128 以下推奨）");
        o.dialogBackgroundColour = colours::panel;
        o.componentToCentreAround = this;
        o.useNativeTitleBar = true;
        o.resizable = true;
        o.launchAsync();
    };
    btnPlugins.onClick = [this] { host.showPluginManager(this); };
    btnRec.onClick = [this] { toggleRecord(); };
    btnPanic.onClick = [this] { engine.panic(!engine.isPanicked()); };
    btnPreset.onClick = [this] {
        juce::PopupMenu m;
        m.addItem(1, u8("プリセットを書き出し（設定・シーン・VST状態）…"));
        m.addItem(2, u8("プリセットを読み込み…"));
        m.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&btnPreset), [this](int r) {
            if (r == 1) exportPreset();
            if (r == 2) importPreset();
        });
    };

    // ---- ルーティング
    lblSource.setText(u8("伴奏"), juce::dontSendNotification);
    lblMon.setText(u8("モニター出力"), juce::dontSendNotification);
    lblStream.setText(u8("配信出力"), juce::dontSendNotification);
    for (auto* l : { &lblSource, &lblMon, &lblStream }) { l->setColour(juce::Label::textColourId, colours::accent2); addAndMakeVisible(l); }
    sourceInfo.setColour(juce::Label::textColourId, colours::muted);
    sourceInfo.setFont(juce::FontOptions(12.5f));
    addAndMakeVisible(sourceInfo);
    cbSource.addItem(u8("なし"), srcNone);
    cbSource.addItem(u8("ブラウザ連携（YouTube タブ）"), srcBrowser);
    cbSource.addItem(u8("メインデバイスの入力ch"), srcDeviceIn);
    cbSource.addItem(u8("別のオーディオデバイス"), srcSecondary);
    cbSource.addItem(u8("音声ファイル"), srcFile);
    for (auto* c : { &cbSource, &cbSourceDetail, &cbMonOut, &cbStreamOut }) { addAndMakeVisible(c); noFocus(*c); }
    cbSource.onChange = [this] { applyMusicSource(); refreshRouting(); };
    cbSourceDetail.onChange = [this] { applyMusicSource(); };
    cbMonOut.onChange = [this] { engine.monitorOutCh.store((cbMonOut.getSelectedId() - 1) * 2); };
    cbStreamOut.onChange = [this] { applyStreamOut(); };
    btnOpenPage.setButtonText(u8("連携ページを開く"));
    btnOpenPage.onClick = [this] { juce::URL(bridge.getUrl()).launchInDefaultBrowser(); };
    btnFile.setButtonText(u8("ファイルを開く…"));
    btnFile.onClick = [this] {
        chooser = std::make_unique<juce::FileChooser>(u8("伴奏ファイル"), juce::File(), engine.formatManager.getWildcardForAllFormats());
        chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this](const juce::FileChooser& fc) {
            if (fc.getResult().existsAsFile()) {
                if (!engine.loadMusicFile(fc.getResult())) showError(u8("このファイルは読み込めません"));
                cbSource.setSelectedId(srcFile, juce::dontSendNotification);
                refreshRouting();
            }
        });
    };
    btnPlay.setButtonText(u8("▶ 再生"));
    btnPlay.onClick = [this] {
        if (engine.transport.isPlaying()) engine.transport.stop();
        else {
            if (engine.transport.getCurrentPosition() >= engine.transport.getLengthInSeconds() - 0.1) engine.transport.setPosition(0);
            engine.transport.start();
        }
    };
    for (auto* b : { &btnOpenPage, &btnFile, &btnPlay }) { addChildComponent(b); noFocus(*b); }

    // ---- シーン
    scenes = defaultScenes();
    for (int i = 0; i < 6; ++i) {
        auto* b = sceneButtons.add(new juce::TextButton());
        noFocus(*b);
        b->setClickingTogglesState(false);
        b->onClick = [this, i] {
            if (juce::ModifierKeys::currentModifiers.isShiftDown()) storeScene(i);
            else recallScene(i);
        };
        b->setTooltip(u8("クリックで呼び出し / Shift+クリックで現在値を保存 / 右クリックで名前変更"));
        b->addMouseListener(this, false);
        addAndMakeVisible(b);
    }
    btnTap.setButtonText("TAP");
    btnTap.onClick = [this] { tap(); };
    btnThrow.setButtonText(u8("THROW (D)"));
    btnThrow.setTooltip(u8("押している間ディレイへ送る（手動スロー）。フットスイッチは MIDI CC64"));
    btnThrow.onStateChange = [this] { engine.throwManual(btnThrow.isDown()); };
    for (auto* b : { &btnTap, &btnThrow }) { addAndMakeVisible(b); noFocus(*b); }

    // ---- ミキサー
    buildColumns();
    viewport.setViewedComponent(&content, false);
    viewport.setScrollBarsShown(true, false);
    addAndMakeVisible(viewport);

    // ---- オーディオ
    deviceManager.addChangeListener(this);
    loadState();
    deviceManager.addAudioCallback(&engine);
    for (auto& d : juce::MidiInput::getAvailableDevices()) deviceManager.setMidiInputDeviceEnabled(d.identifier, true);
    deviceManager.addMidiInputDeviceCallback({}, this);
    if (!bridge.start()) showError(u8("ブラウザ連携用のポート ") + juce::String(kBridgePort) + u8(" を開けませんでした（他のアプリが使用中？）"));

    setSize(1400, 900);
    refreshRouting();
    renderScenes();
    startTimerHz(30);
}

MainComponent::~MainComponent() {
    stopTimer();
    saveState();
    host.closeAllEditors();
    deviceManager.removeMidiInputDeviceCallback({}, this);
    deviceManager.removeAudioCallback(&engine);
    deviceManager.removeChangeListener(this);
    secIn.close();
    secOut.close();
    bridge.stop();
    deviceManager.closeAudioDevice();
    juce::LookAndFeel::setDefaultLookAndFeel(nullptr);
    setLookAndFeel(nullptr);
}

// ------------------------------------------------------------------ ミキサー列
void MainComponent::buildColumns() {
    const std::pair<const char*, const char*> cols[] = { { "vocal", "VOCAL" }, { "fx", "FX" }, { "music", "MUSIC" }, { "master", "MASTER" } };
    for (auto& [strip, t] : cols) {
        Column c;
        c.strip = strip;
        c.title = t;
        c.label = std::make_unique<juce::Label>();
        c.label->setText(t, juce::dontSendNotification);
        c.label->setFont(juce::FontOptions(15.0f, juce::Font::bold));
        c.label->setColour(juce::Label::textColourId, colours::accent2);
        content.addAndMakeVisible(*c.label);
        c.meter = std::make_unique<Meter>(c.strip == "vocal" ? 1 : 2);
        content.addAndMakeVisible(*c.meter);
        columns.push_back(std::move(c));
    }
    for (auto& g : groupDefs()) {
        auto* p = panels.add(new ModulePanel(g, engine, host));
        p->onLayoutChanged = [this] { layoutColumns(); };
        content.addAndMakeVisible(p);
        for (auto& c : columns)
            if (c.strip == g.strip) c.panels.push_back(p);
        if (g.id == "music") {
            btnRelearn.setButtonText(u8("曲が変わったのでラウドネスを再測定"));
            btnRelearn.onClick = [this] { engine.relearnMusic(); };
            p->addExtra(&btnRelearn);
        }
        if (g.id == "latency") {
            btnLatencyAuto.setButtonText(u8("デバイスのレイテンシから自動推定"));
            btnLatencyAuto.onClick = [this] {
                if (auto* d = deviceManager.getCurrentAudioDevice()) {
                    const double ms = (d->getInputLatencyInSamples() + d->getOutputLatencyInSamples() + d->getCurrentBufferSizeSamples())
                                    / d->getCurrentSampleRate() * 1000.0;
                    engine.setParam(sysComp, (float) std::round(ms));
                }
            };
            p->addExtra(&btnLatencyAuto);
        }
        if (g.id == "master") {
            for (auto* l : { &loudM, &loudS, &loudI }) {
                l->setFont(juce::FontOptions(juce::Font::getDefaultMonospacedFontName(), 15.0f, juce::Font::bold));
                p->addExtra(l);
            }
            loudNote.setText(u8("YouTube 基準は約 -14 LUFS（歌枠は -16〜-14 目安）"), juce::dontSendNotification);
            loudNote.setColour(juce::Label::textColourId, colours::muted);
            loudNote.setFont(juce::FontOptions(12.0f));
            p->addExtra(&loudNote);
            btnLoudReset.setButtonText(u8("Integrated をリセット"));
            btnLoudReset.onClick = [this] { engine.resetLoudness(); };
            p->addExtra(&btnLoudReset);
        }
    }
    for (auto* b : { &btnRelearn, &btnLatencyAuto, &btnLoudReset }) noFocus(*b);
}

void MainComponent::layoutColumns() {
    const int w = viewport.getWidth() - viewport.getScrollBarThickness();
    const int nCols = w >= 1100 ? 4 : w >= 560 ? 2 : 1;
    const int gap = 10;
    const int colW = (w - gap * (nCols + 1)) / nCols;
    std::vector<int> y((size_t) nCols, 8);
    for (size_t ci = 0; ci < columns.size(); ++ci) {
        auto& c = columns[ci];
        size_t k = 0;
        for (size_t j = 1; j < y.size(); ++j) if (y[j] < y[k]) k = j; // 一番短い列へ
        const int x = gap + (int) k * (colW + gap);
        c.label->setBounds(x, y[k], 100, 24);
        c.meter->setBounds(x + colW - 160, y[k] + 5, 160, 14);
        y[k] += 30;
        for (auto* p : c.panels) {
            const int h = p->preferredHeight();
            p->setBounds(x, y[k], colW, h);
            y[k] += h + 8;
        }
        y[k] += 10;
    }
    content.setSize(w, *std::max_element(y.begin(), y.end()) + 10);
}

// ------------------------------------------------------------------ レイアウト
void MainComponent::paint(juce::Graphics& g) {
    g.fillAll(colours::bg);
    g.setColour(colours::line);
    g.drawHorizontalLine(48, 0.0f, (float) getWidth());
    g.setColour(colours::panel);
    g.fillRoundedRectangle(juce::Rectangle<float>(10.0f, 56.0f, (float) getWidth() - 20.0f, 86.0f), 10.0f);
    g.fillRoundedRectangle(juce::Rectangle<float>(10.0f, 150.0f, (float) getWidth() - 20.0f, 52.0f), 10.0f);
}

void MainComponent::resized() {
    auto r = getLocalBounds();
    auto head = r.removeFromTop(48).reduced(12, 8);
    title.setBounds(head.removeFromLeft(150));
    for (auto* b : { &btnPanic, &btnRec, &btnPreset, &btnPlugins, &btnAudio }) {
        b->setBounds(head.removeFromRight(b == &btnPanic ? 80 : 120));
        head.removeFromRight(6);
    }
    status.setBounds(head);

    auto route = juce::Rectangle<int>(20, 62, getWidth() - 40, 74);
    auto row1 = route.removeFromTop(34).reduced(0, 3);
    lblSource.setBounds(row1.removeFromLeft(44));
    cbSource.setBounds(row1.removeFromLeft(240));
    row1.removeFromLeft(6);
    const int detailW = 220;
    for (auto* c : std::initializer_list<juce::Component*> { &cbSourceDetail, &btnOpenPage, &btnFile })
        c->setBounds(row1.getX(), row1.getY(), detailW, row1.getHeight());
    btnPlay.setBounds(row1.getX() + detailW + 6, row1.getY(), 90, row1.getHeight());
    row1.removeFromLeft(detailW + 102);
    sourceInfo.setBounds(row1);
    auto row2 = route.removeFromTop(34).reduced(0, 3);
    lblMon.setBounds(row2.removeFromLeft(90));
    cbMonOut.setBounds(row2.removeFromLeft(260));
    row2.removeFromLeft(20);
    lblStream.setBounds(row2.removeFromLeft(70));
    cbStreamOut.setBounds(row2.removeFromLeft(340));

    auto sc = juce::Rectangle<int>(20, 156, getWidth() - 40, 40);
    btnThrow.setBounds(sc.removeFromRight(110).reduced(0, 2));
    sc.removeFromRight(6);
    btnTap.setBounds(sc.removeFromRight(100).reduced(0, 2));
    sc.removeFromRight(10);
    const int bw = sc.getWidth() / 6;
    for (int i = 0; i < 6; ++i) sceneButtons[i]->setBounds(sc.getX() + i * bw, sc.getY() + 2, bw - 6, sc.getHeight() - 4);

    viewport.setBounds(r.withTrimmedTop(210 - 48));
    layoutColumns();
}

// ------------------------------------------------------------------ ルーティング
juce::String MainComponent::secondaryTypeName() {
    auto cur = deviceManager.getCurrentAudioDeviceType();
    if (cur != "ASIO") return cur;
    for (auto* t : deviceManager.getAvailableDeviceTypes())
        if (t->getTypeName() != "ASIO") return t->getTypeName();
    return cur;
}

void MainComponent::refreshRouting() {
    auto* dev = deviceManager.getCurrentAudioDevice();
    juce::StringArray ins, outs;
    if (dev) {
        auto names = dev->getInputChannelNames();
        auto act = dev->getActiveInputChannels();
        for (int i = 0; i < names.size(); ++i) if (act[i]) ins.add(names[i]);
        names = dev->getOutputChannelNames();
        act = dev->getActiveOutputChannels();
        for (int i = 0; i < names.size(); ++i) if (act[i]) outs.add(names[i]);
    }
    // マイクの入力チャンネル候補
    juce::StringArray chItems;
    for (int i = 0; i < ins.size(); ++i) chItems.add("IN " + juce::String(i + 1) + ": " + ins[i]);
    if (chItems.isEmpty()) chItems.add(u8("（入力なし）"));
    for (auto* p : panels)
        if (auto* row = p->findRow(inChannel)) row->setChoices(chItems);

    // 出力ペア
    auto pairName = [&](int i) { return juce::String(i + 1) + "-" + juce::String(i + 2) + ": " + outs[i] + (i + 1 < outs.size() ? " / " + outs[i + 1] : juce::String()); };
    const int monSel = engine.monitorOutCh.load() / 2 + 1;
    cbMonOut.clear(juce::dontSendNotification);
    for (int i = 0; i < outs.size(); i += 2) cbMonOut.addItem(pairName(i), i / 2 + 1);
    cbMonOut.setSelectedId(monSel, juce::dontSendNotification);

    const auto type = secondaryTypeName();
    secTypeDevicesIn.clear();
    secTypeDevicesOut.clear();
    for (auto* t : deviceManager.getAvailableDeviceTypes())
        if (t->getTypeName() == type) { t->scanForDevices(); secTypeDevicesIn = t->getDeviceNames(true); secTypeDevicesOut = t->getDeviceNames(false); }

    const int so = engine.streamOutCh.load();
    const auto secOutName = secOut.getName();
    cbStreamOut.clear(juce::dontSendNotification);
    cbStreamOut.addItem(u8("出力しない"), 1);
    for (int i = 0; i < outs.size(); i += 2) cbStreamOut.addItem(u8("メインデバイス ") + pairName(i), 100 + i / 2);
    cbStreamOut.addSeparator();
    for (int i = 0; i < secTypeDevicesOut.size(); ++i) cbStreamOut.addItem(u8("別デバイス: ") + secTypeDevicesOut[i], 1000 + i);
    if (so == kOutSecondary) cbStreamOut.setSelectedId(1000 + secTypeDevicesOut.indexOf(secOutName), juce::dontSendNotification);
    else if (so >= 0) cbStreamOut.setSelectedId(100 + so / 2, juce::dontSendNotification);
    else cbStreamOut.setSelectedId(1, juce::dontSendNotification);

    // 伴奏ソースの詳細
    const int src = cbSource.getSelectedId();
    cbSourceDetail.setVisible(src == srcDeviceIn || src == srcSecondary);
    btnOpenPage.setVisible(src == srcBrowser);
    btnFile.setVisible(src == srcFile);
    btnPlay.setVisible(src == srcFile);
    if (src == srcDeviceIn) {
        const int sel = engine.musicInputCh.load() / 2 + 1;
        cbSourceDetail.clear(juce::dontSendNotification);
        for (int i = 0; i < ins.size(); i += 2) cbSourceDetail.addItem("IN " + juce::String(i + 1) + "-" + juce::String(i + 2), i / 2 + 1);
        cbSourceDetail.setSelectedId(sel, juce::dontSendNotification);
    } else if (src == srcSecondary) {
        const auto cur = secIn.getName();
        cbSourceDetail.clear(juce::dontSendNotification);
        for (int i = 0; i < secTypeDevicesIn.size(); ++i) cbSourceDetail.addItem(secTypeDevicesIn[i], i + 1);
        cbSourceDetail.setSelectedId(secTypeDevicesIn.indexOf(cur) + 1, juce::dontSendNotification);
    }
}

void MainComponent::applyMusicSource() {
    const int src = cbSource.getSelectedId();
    if (src != srcSecondary) secIn.close();
    switch (src) {
        case srcBrowser: engine.musicSource.store((int) MusicSource::browser); break;
        case srcDeviceIn:
            engine.musicInputCh.store(juce::jmax(0, (cbSourceDetail.getSelectedId() - 1) * 2));
            engine.musicSource.store((int) MusicSource::deviceInputs);
            break;
        case srcSecondary: {
            const auto name = cbSourceDetail.getText();
            if (name.isNotEmpty() && name != secIn.getName()) {
                auto* d = deviceManager.getCurrentAudioDevice();
                const auto err = secIn.open(deviceManager, secondaryTypeName(), name, d ? d->getCurrentSampleRate() : 48000.0);
                if (err.isNotEmpty()) showError(err);
            }
            engine.musicSource.store((int) MusicSource::secondaryDevice);
            break;
        }
        case srcFile: engine.musicSource.store((int) MusicSource::file); break;
        default: engine.musicSource.store((int) MusicSource::none);
    }
    engine.relearnMusic();
}

void MainComponent::applyStreamOut() {
    const int id = cbStreamOut.getSelectedId();
    if (id >= 1000) {
        const auto name = secTypeDevicesOut[id - 1000];
        if (name != secOut.getName()) {
            auto* d = deviceManager.getCurrentAudioDevice();
            const auto err = secOut.open(deviceManager, secondaryTypeName(), name, d ? d->getCurrentSampleRate() : 48000.0);
            if (err.isNotEmpty()) { showError(err); return; }
        }
        engine.streamOutCh.store(kOutSecondary);
    } else {
        secOut.close();
        engine.streamOutCh.store(id >= 100 ? (id - 100) * 2 : kOutNone);
        if (id >= 100 && (id - 100) * 2 == engine.monitorOutCh.load())
            showError(u8("配信出力がモニター出力と同じチャンネルです。OBS へは仮想デバイスか別の出力チャンネルを使ってください"));
    }
}

void MainComponent::changeListenerCallback(juce::ChangeBroadcaster*) {
    refreshRouting();
    saveCountdown = 30;
}

// ------------------------------------------------------------------ シーン
void MainComponent::renderScenes() {
    for (int i = 0; i < 6; ++i) {
        auto* b = sceneButtons[i];
        b->setButtonText(juce::String(i + 1) + "  " + scenes[(size_t) i].name);
        const bool on = i == activeScene;
        b->setColour(juce::TextButton::buttonColourId, on ? juce::Colour(0xff2a1520) : colours::panel2);
        b->setColour(juce::TextButton::textColourOffId, on ? colours::accent : colours::text);
    }
}

void MainComponent::recallScene(int i) {
    if (i < 0 || i >= (int) scenes.size()) return;
    const auto& s = scenes[(size_t) i];
    const float xf = engine.getParam(sysXfade);
    for (auto& p : paramDefs())
        if (p.scene) engine.setParam(p.index, s.values[(size_t) p.index], xf);
    for (int c = 0; c < kNumChains; ++c)
        for (int k = 0; k < PluginChain::kSlots; ++k)
            if (engine.chains[(size_t) c]->get(k)) engine.chains[(size_t) c]->setBypassed(k, s.bypass[(size_t) c][(size_t) k]);
    activeScene = i;
    renderScenes();
    saveCountdown = 30;
}

void MainComponent::storeScene(int i) {
    auto& s = scenes[(size_t) i];
    for (auto& p : paramDefs()) s.values[(size_t) p.index] = engine.getParam(p.index);
    for (int c = 0; c < kNumChains; ++c)
        for (int k = 0; k < PluginChain::kSlots; ++k) s.bypass[(size_t) c][(size_t) k] = engine.chains[(size_t) c]->isBypassed(k);
    activeScene = i;
    renderScenes();
    setStatusMessage(u8("シーン ") + juce::String(i + 1) + u8("「") + s.name + u8("」に保存しました"));
    saveCountdown = 30;
}

void MainComponent::setStatusMessage(const juce::String& msg) {
    status.setText(msg, juce::dontSendNotification);
    status.setColour(juce::Label::textColourId, colours::accent2);
    statusHoldUntil = juce::Time::getMillisecondCounter() + 2500;
}

void MainComponent::mouseDown(const juce::MouseEvent& e) {
    if (!e.mods.isPopupMenu()) return;
    for (int i = 0; i < sceneButtons.size(); ++i)
        if (e.eventComponent == sceneButtons[i]) renameScene(i);
}

void MainComponent::renameScene(int i) {
    renameWindow = std::make_unique<juce::AlertWindow>(u8("シーン名"), juce::String(), juce::MessageBoxIconType::NoIcon, this);
    renameWindow->addTextEditor("name", scenes[(size_t) i].name);
    renameWindow->addButton("OK", 1, juce::KeyPress(juce::KeyPress::returnKey));
    renameWindow->addButton(u8("キャンセル"), 0, juce::KeyPress(juce::KeyPress::escapeKey));
    juce::Component::SafePointer<MainComponent> safe(this);
    renameWindow->enterModalState(true, juce::ModalCallbackFunction::create([safe, i](int r) {
        if (safe == nullptr) return;
        if (r == 1 && safe->renameWindow) {
            const auto name = safe->renameWindow->getTextEditorContents("name").trim().substring(0, 24);
            if (name.isNotEmpty()) safe->scenes[(size_t) i].name = name;
            safe->renderScenes();
            safe->saveCountdown = 30;
        }
        juce::MessageManager::callAsync([safe] {
            if (safe != nullptr) safe->renameWindow.reset();
        });
    }), false);
}

void MainComponent::tap() {
    const double now = juce::Time::getMillisecondCounterHiRes();
    if (!taps.empty() && now - taps.back() > 2000) taps.clear();
    taps.push_back(now);
    if (taps.size() > 5) taps.erase(taps.begin());
    if (taps.size() >= 2) {
        const double iv = (taps.back() - taps.front()) / (double) (taps.size() - 1);
        engine.setParam(dlyBpm, (float) (std::round(60000.0 / iv * 2) / 2));
    }
}

bool MainComponent::keyPressed(const juce::KeyPress& k) {
    const int code = k.getKeyCode();
    if (code >= '1' && code <= '6') {
        if (k.getModifiers().isShiftDown()) storeScene(code - '1');
        else recallScene(code - '1');
        return true;
    }
    if (code == 'T' || code == 't') { tap(); return true; }
    if (code == juce::KeyPress::escapeKey) { engine.panic(!engine.isPanicked()); return true; }
    return code == 'D' || code == 'd';
}

bool MainComponent::keyStateChanged(bool) {
    const bool d = juce::KeyPress::isKeyCurrentlyDown('D') || juce::KeyPress::isKeyCurrentlyDown('d');
    if (d != throwKeyDown) {
        throwKeyDown = d;
        engine.throwManual(d);
    }
    return false;
}

void MainComponent::handleIncomingMidiMessage(juce::MidiInput*, const juce::MidiMessage& m) {
    // プログラムチェンジ 0-5 / ノート 36-41 → シーン、CC64（サステインペダル）→ 手動スロー
    if (m.isController() && m.getControllerNumber() == 64) { engine.throwManual(m.getControllerValue() >= 64); return; }
    int scene = -1;
    if (m.isProgramChange()) scene = m.getProgramChangeNumber();
    if (m.isNoteOn() && m.getNoteNumber() >= 36 && m.getNoteNumber() < 42) scene = m.getNoteNumber() - 36;
    if (scene >= 0 && scene < 6) {
        juce::Component::SafePointer<MainComponent> safe(this);
        juce::MessageManager::callAsync([safe, scene] {
            if (safe != nullptr) safe->recallScene(scene);
        });
    }
}

// ------------------------------------------------------------------ 録音
void MainComponent::toggleRecord() {
    if (engine.isRecording()) {
        engine.stopRecording();
        btnRec.setButtonText(u8("● 録音"));
        btnRec.setColour(juce::TextButton::buttonColourId, colours::panel2);
        engine.getRecordingFile().revealToUser();
        return;
    }
    auto dir = juce::File::getSpecialLocation(juce::File::userMusicDirectory).getChildFile("UTAWAKU LIVE");
    auto f = dir.getChildFile("utawaku-" + juce::Time::getCurrentTime().formatted("%Y%m%d-%H%M%S") + ".wav");
    if (engine.startRecording(f)) {
        btnRec.setButtonText(u8("■ 停止"));
        btnRec.setColour(juce::TextButton::buttonColourId, colours::bad);
    } else showError(u8("録音ファイルを作成できません: ") + f.getFullPathName());
}

// ------------------------------------------------------------------ 定期更新
void MainComponent::timerCallback() {
    auto& m = engine.meters;
    for (auto& c : columns) {
        if (c.strip == "vocal") c.meter->push(m.vocalOut.exchange(0));
        else if (c.strip == "music") c.meter->push(m.musicL.exchange(0), m.musicR.exchange(0));
        else if (c.strip == "master") c.meter->push(m.masterL.exchange(0), m.masterR.exchange(0));
        else c.meter->push(m.throwAmt.load() * 0.9f, m.throwAmt.load() * 0.9f);
    }
    const float grGate = m.grGate.exchange(0), grC1 = m.grC1.exchange(0), grDs = m.grDs.exchange(0), grC2 = m.grC2.exchange(0);
    const float grGlue = m.grGlue.exchange(0), grLim = m.grLim.exchange(0);
    for (auto* p : panels) {
        const auto& id = p->group.id;
        juce::String b;
        if (id == "input") b = juce::String(20.0f * std::log10(juce::jmax(1e-6f, m.vocalIn.exchange(0))), 1) + " dB";
        else if (id == "gate") b = fmtGr(grGate);
        else if (id == "comp1") b = fmtGr(grC1);
        else if (id == "deess") b = fmtGr(grDs);
        else if (id == "comp2") b = fmtGr(grC2);
        else if (id == "rider") b = (m.riderDb.load() >= 0 ? "+" : "") + juce::String(m.riderDb.load(), 1) + " dB";
        else if (id == "carve") b = juce::String(m.carveDb.load(), 1) + " dB";
        else if (id == "music") b = fmtLufs(m.agLufs.load()) + " LU " + (m.agGain.load() >= 0 ? "+" : "") + juce::String(m.agGain.load(), 1);
        else if (id == "master") b = "C " + juce::String(grGlue, 1) + "  L " + juce::String(grLim, 1);
        else if (id == "delay") b = juce::String(juce::roundToInt(engine.currentDelaySeconds() * 1000)) + " ms";
        else if (id == "throw") b = m.throwAmt.load() > 0.3f ? juce::String("THROW") : juce::String();
        else if (id == "vins" || id == "latency") b = juce::String(engine.vocalPluginLatency() * 1000.0 / juce::jmax(1.0, engine.getSampleRate()), 1) + " ms";
        else if (id == "monitor") b = juce::String(20.0f * std::log10(juce::jmax(1e-6f, m.monitor.exchange(0))), 1) + " dB";
        p->setBadge(b);
        p->sync();
    }
    auto lu = [&](juce::Label& l, const char* name, float v) {
        l.setText(juce::String(name) + "  " + fmtLufs(v) + " LUFS", juce::dontSendNotification);
        l.setColour(juce::Label::textColourId, !std::isfinite(v) ? colours::muted : v > -13.0f ? colours::bad : v < -18.0f ? colours::warn : colours::ok);
    };
    lu(loudM, "Momentary ", m.lufsM.load());
    lu(loudS, "Short-term", m.lufsS.load());
    lu(loudI, "Integrated", m.lufsI.load());

    // ステータス
    juce::String st;
    if (auto* d = deviceManager.getCurrentAudioDevice()) {
        const double sr = d->getCurrentSampleRate();
        const double rt = (d->getInputLatencyInSamples() + d->getOutputLatencyInSamples() + d->getCurrentBufferSizeSamples()) / sr * 1000.0;
        st << d->getTypeName() << " / " << d->getName() << "  " << juce::String(sr / 1000.0, 1) << " kHz  " << d->getCurrentBufferSizeSamples()
           << u8(" smp  往復約 ") << juce::roundToInt(rt) << " ms  CPU " << juce::roundToInt(m.cpu.load() * 100) << "%";
    } else st = u8("オーディオデバイス未選択 →「オーディオ設定」");
    if (juce::Time::getMillisecondCounter() > statusHoldUntil) {
        status.setText(st, juce::dontSendNotification);
        status.setColour(juce::Label::textColourId, colours::muted);
    }

    juce::String si;
    switch (cbSource.getSelectedId()) {
        case srcBrowser:
            si = bridge.isClientConnected() ? (engine.browserBridge.isActive() ? u8("受信中: ") + bridge.getClientInfo() + u8("  バッファ ")
                                                 + juce::String(engine.browserBridge.fillMs.load(), 0) + " ms  " + juce::String(engine.browserBridge.ppm.load(), 0) + " ppm"
                                                                             : u8("連携ページ接続済み（タブ未共有）"))
                                            : u8("連携ページ未接続 → ") + bridge.getUrl() + u8(" を Chrome/Edge で開く");
            break;
        case srcSecondary: si = secIn.isOpen() ? u8("受信中  バッファ ") + juce::String(engine.secondaryInBridge.fillMs.load(), 0) + " ms" : u8("デバイスを選択"); break;
        case srcFile:
            si = engine.musicFileName.isNotEmpty() ? engine.musicFileName + "  " + juce::String(engine.transport.getCurrentPosition(), 0) + " / "
                                                          + juce::String(engine.transport.getLengthInSeconds(), 0) + " s"
                                                    : u8("ファイル未選択");
            btnPlay.setButtonText(engine.transport.isPlaying() ? u8("■ 停止") : u8("▶ 再生"));
            break;
        default: break;
    }
    sourceInfo.setText(si, juce::dontSendNotification);
    btnPanic.setColour(juce::TextButton::buttonColourId, engine.isPanicked() ? colours::bad : colours::panel2);
    btnTap.setButtonText("TAP " + juce::String(engine.getParam(dlyBpm), 1));
    btnThrow.setColour(juce::TextButton::buttonColourId, m.throwAmt.load() > 0.3f ? colours::accent2.darker(0.3f) : colours::panel2);

    if (--saveCountdown == 0) saveState();
    if (saveCountdown < -150) saveCountdown = 1; // 約5秒ごとに保存
}

// ------------------------------------------------------------------ 保存・復元
std::unique_ptr<juce::XmlElement> MainComponent::stateToXml(bool includeRouting) const {
    auto xml = std::make_unique<juce::XmlElement>("UtawakuLive");
    xml->setAttribute("version", 2);
    auto* pe = xml->createNewChildElement("Params");
    for (auto& p : paramDefs()) pe->setAttribute(p.id.replaceCharacter('.', '_'), engine.getParam(p.index));
    auto* se = xml->createNewChildElement("Scenes");
    se->setAttribute("active", activeScene);
    for (auto& s : scenes) {
        auto* e = se->createNewChildElement("Scene");
        e->setAttribute("name", s.name);
        for (auto& p : paramDefs())
            if (p.scene) e->setAttribute(p.id.replaceCharacter('.', '_'), s.values[(size_t) p.index]);
        juce::String byp;
        for (auto& c : s.bypass)
            for (bool b : c) byp << (b ? '1' : '0');
        e->setAttribute("bypass", byp);
    }
    xml->addChildElement(host.chainsToXml().release());
    if (includeRouting) {
        auto* r = xml->createNewChildElement("Routing");
        r->setAttribute("source", cbSource.getSelectedId());
        r->setAttribute("musicCh", engine.musicInputCh.load());
        r->setAttribute("monOut", engine.monitorOutCh.load());
        r->setAttribute("streamOut", engine.streamOutCh.load());
        r->setAttribute("secIn", secIn.getName());
        r->setAttribute("secOut", secOut.getName());
    }
    return xml;
}

void MainComponent::applyStateXml(const juce::XmlElement& xml, bool includeRouting) {
    if (auto* pe = xml.getChildByName("Params"))
        for (auto& p : paramDefs()) {
            const auto key = p.id.replaceCharacter('.', '_');
            if (pe->hasAttribute(key)) engine.setParam(p.index, (float) pe->getDoubleAttribute(key), 0.0f);
        }
    if (auto* se = xml.getChildByName("Scenes")) {
        int i = 0;
        for (auto* e : se->getChildWithTagNameIterator("Scene")) {
            if (i >= (int) scenes.size()) break;
            auto& s = scenes[(size_t) i++];
            s.name = e->getStringAttribute("name", s.name);
            for (auto& p : paramDefs()) {
                const auto key = p.id.replaceCharacter('.', '_');
                if (p.scene && e->hasAttribute(key)) s.values[(size_t) p.index] = (float) e->getDoubleAttribute(key);
            }
            const auto byp = e->getStringAttribute("bypass");
            int k = 0;
            for (auto& c : s.bypass)
                for (auto& b : c) { b = k < byp.length() && byp[k] == '1'; ++k; }
        }
        activeScene = juce::jlimit(0, 5, se->getIntAttribute("active"));
    }
    if (auto* ce = xml.getChildByName("Chains")) host.restoreChains(*ce, [this] { for (auto* p : panels) p->sync(); });
    if (includeRouting)
        if (auto* r = xml.getChildByName("Routing")) {
            engine.musicInputCh.store(r->getIntAttribute("musicCh", 2));
            engine.monitorOutCh.store(r->getIntAttribute("monOut", 0));
            const int so = r->getIntAttribute("streamOut", kOutNone);
            engine.streamOutCh.store(so == kOutSecondary ? kOutNone : so);
            cbSource.setSelectedId(r->getIntAttribute("source", srcBrowser), juce::dontSendNotification);
            auto* d = deviceManager.getCurrentAudioDevice();
            const double sr = d ? d->getCurrentSampleRate() : 48000.0;
            if (cbSource.getSelectedId() == srcSecondary && r->getStringAttribute("secIn").isNotEmpty())
                secIn.open(deviceManager, secondaryTypeName(), r->getStringAttribute("secIn"), sr);
            if (so == kOutSecondary && r->getStringAttribute("secOut").isNotEmpty())
                if (secOut.open(deviceManager, secondaryTypeName(), r->getStringAttribute("secOut"), sr).isEmpty()) engine.streamOutCh.store(kOutSecondary);
            refreshRouting();
            applyMusicSource();
        }
    renderScenes();
}

void MainComponent::loadState() {
    auto devXml = settings.getXmlValue("audioDevice");
    const auto err = deviceManager.initialise(32, 32, devXml.get(), true);
    if (err.isNotEmpty()) showError(err);
    cbSource.setSelectedId(srcBrowser, juce::dontSendNotification);
    engine.musicSource.store((int) MusicSource::browser);
    if (auto xml = settings.getXmlValue("state")) applyStateXml(*xml, true);
}

void MainComponent::saveState() {
    if (auto dev = deviceManager.createStateXml()) settings.setValue("audioDevice", dev.get());
    settings.setValue("state", stateToXml(true).get());
    settings.saveIfNeeded();
}

void MainComponent::exportPreset() {
    chooser = std::make_unique<juce::FileChooser>(u8("プリセットの書き出し"), juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("utawaku.ulpreset"), "*.ulpreset");
    chooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting, [this](const juce::FileChooser& fc) {
        auto f = fc.getResult();
        if (f == juce::File()) return;
        if (!stateToXml(false)->writeTo(f.withFileExtension("ulpreset"))) showError(u8("書き出せませんでした"));
    });
}

void MainComponent::importPreset() {
    chooser = std::make_unique<juce::FileChooser>(u8("プリセットの読み込み"), juce::File(), "*.ulpreset");
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this](const juce::FileChooser& fc) {
        auto xml = juce::XmlDocument::parse(fc.getResult());
        if (xml == nullptr || !xml->hasTagName("UtawakuLive")) { if (fc.getResult() != juce::File()) showError(u8("プリセットファイルではありません")); return; }
        applyStateXml(*xml, false);
    });
}

void MainComponent::showError(const juce::String& msg) {
    juce::AlertWindow::showAsync(juce::MessageBoxOptions().withIconType(juce::MessageBoxIconType::WarningIcon).withTitle("UTAWAKU LIVE").withMessage(msg).withButton("OK"),
                                 nullptr);
}

} // namespace ul
