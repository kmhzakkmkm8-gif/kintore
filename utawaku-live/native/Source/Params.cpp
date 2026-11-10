#include "Params.h"

namespace ul {

namespace {
struct Builder {
    std::vector<ParamDef> v = std::vector<ParamDef>((size_t) kNumParams);
    ParamDef& add(ParamId i, const char* id, const char* g, const char* label, float d, float mn, float mx, float st, const char* unit = "", bool scene = true) {
        auto& p = v[(size_t) i];
        p.index = i; p.id = id; p.group = g; p.label = juce::String::fromUTF8(label); p.unit = unit;
        p.def = d; p.min = mn; p.max = mx; p.step = st; p.scene = scene; p.type = PType::Float;
        return p;
    }
    ParamDef& tog(ParamId i, const char* id, const char* g, const char* label, bool d, bool scene = true) {
        auto& p = add(i, id, g, label, d ? 1.f : 0.f, 0, 1, 1, "", scene);
        p.type = PType::Toggle;
        return p;
    }
    ParamDef& choice(ParamId i, const char* id, const char* g, const char* label, int d, std::initializer_list<const char*> c, bool scene = true) {
        auto& p = add(i, id, g, label, (float) d, 0, (float) c.size() - 1, 1, "", scene);
        p.type = PType::Choice;
        for (auto* s : c) p.choices.add(juce::String::fromUTF8(s));
        return p;
    }
};
constexpr bool G = false; // scene=false（機材・その日のセッティング）

std::vector<ParamDef> build() {
    Builder b;
    b.add(inTrim, "in.trim", "input", "入力ゲイン", 0, -20, 30, 0.5f, "dB", G);
    b.add(inChannel, "in.channel", "input", "入力チャンネル", 0, 0, 31, 1, "", G).type = PType::Choice; // 選択肢はデバイスから
    b.tog(inSum, "in.sum", "input", "隣のchと合算 (ステレオマイク)", false, G);
    b.add(vHpf, "v.hpf", "input", "ローカット", 90, 20, 300, 1, "Hz");
    b.add(gateThr, "gate.thr", "gate", "スレッショルド", -55, -90, -20, 1, "dB", G);
    b.add(gateRange, "gate.range", "gate", "レンジ (0で無効)", 12, 0, 40, 1, "dB");
    b.add(gateRelease, "gate.release", "gate", "リリース", 150, 20, 1000, 5, "ms");
    b.tog(c1On, "c1.on", "comp1", "使用", true);
    b.add(c1Thr, "c1.thr", "comp1", "スレッショルド", -16, -50, 0, 0.5f, "dB");
    b.add(c1Ratio, "c1.ratio", "comp1", "レシオ", 4, 1, 20, 0.1f, ":1");
    b.add(c1Attack, "c1.attack", "comp1", "アタック", 2, 0.1f, 50, 0.1f, "ms");
    b.add(c1Release, "c1.release", "comp1", "リリース", 60, 10, 500, 1, "ms");
    b.add(c1Makeup, "c1.makeup", "comp1", "メイクアップ", 3, -6, 18, 0.5f, "dB");
    b.tog(eqOn, "eq.on", "eq", "使用", true);
    b.add(eqLoF, "eq.lo.f", "eq", "Low 周波数", 120, 40, 400, 1, "Hz");
    b.add(eqLoG, "eq.lo.g", "eq", "Low (シェルフ)", 0, -12, 12, 0.5f, "dB");
    b.add(eqM1F, "eq.m1.f", "eq", "こもり 周波数", 350, 150, 1200, 5, "Hz");
    b.add(eqM1G, "eq.m1.g", "eq", "こもり (ベル)", -2.5f, -12, 12, 0.5f, "dB");
    b.add(eqM1Q, "eq.m1.q", "eq", "こもり Q", 1.2f, 0.3f, 6, 0.1f);
    b.add(eqM2F, "eq.m2.f", "eq", "抜け 周波数", 3200, 1000, 8000, 10, "Hz");
    b.add(eqM2G, "eq.m2.g", "eq", "抜け (ベル)", 2, -12, 12, 0.5f, "dB");
    b.add(eqM2Q, "eq.m2.q", "eq", "抜け Q", 0.9f, 0.3f, 6, 0.1f);
    b.add(eqHiF, "eq.hi.f", "eq", "Air 周波数", 11000, 5000, 18000, 100, "Hz");
    b.add(eqHiG, "eq.hi.g", "eq", "Air (シェルフ)", 2.5f, -12, 12, 0.5f, "dB");
    b.tog(dsOn, "ds.on", "deess", "使用", true);
    b.add(dsFreq, "ds.freq", "deess", "検出周波数", 6500, 3000, 11000, 50, "Hz");
    b.add(dsThr, "ds.thr", "deess", "スレッショルド", -28, -60, 0, 0.5f, "dB");
    b.add(dsMax, "ds.max", "deess", "最大リダクション", 8, 0, 20, 0.5f, "dB");
    b.add(satDrive, "sat.drive", "sat", "ドライブ", 6, 0, 24, 0.5f, "dB");
    b.add(satMix, "sat.mix", "sat", "ミックス (0で無効)", 20, 0, 100, 1, "%");
    b.tog(c2On, "c2.on", "comp2", "使用", true);
    b.add(c2Thr, "c2.thr", "comp2", "スレッショルド", -22, -50, 0, 0.5f, "dB");
    b.add(c2Ratio, "c2.ratio", "comp2", "レシオ", 2.5f, 1, 10, 0.1f, ":1");
    b.add(c2Attack, "c2.attack", "comp2", "アタック", 15, 1, 100, 1, "ms");
    b.add(c2Release, "c2.release", "comp2", "リリース", 250, 30, 2000, 10, "ms");
    b.add(c2Makeup, "c2.makeup", "comp2", "メイクアップ", 3, -6, 18, 0.5f, "dB");
    b.tog(riderOn, "rider.on", "rider", "有効", true);
    b.add(riderOffset, "rider.offset", "rider", "伴奏に対する目標差", 0, -12, 12, 0.5f, "dB");
    b.add(riderRange, "rider.range", "rider", "可動範囲 ±", 6, 0, 12, 0.5f, "dB");
    b.add(riderSpeed, "rider.speed", "rider", "追従速度", 400, 50, 3000, 10, "ms");
    b.add(riderFloor, "rider.floor", "rider", "歌唱検出レベル", -50, -80, -20, 1, "dB", G);
    b.add(vFader, "v.fader", "vocal", "フェーダー", 0, -60, 12, 0.5f, "dB");
    b.tog(vMute, "v.mute", "vocal", "ミュート", false, G);
    b.tog(revBuiltin, "rev.builtin", "reverb", "内蔵リバーブを使う", true);
    b.choice(revType, "rev.type", "reverb", "タイプ", 0, { "プレート", "ホール", "ルーム", "チェンバー" });
    b.add(revDecay, "rev.decay", "reverb", "残響時間", 1.8f, 0.3f, 6, 0.1f, "s");
    b.add(revPre, "rev.pre", "reverb", "プリディレイ", 30, 0, 150, 1, "ms");
    b.add(revSend, "rev.send", "reverb", "センド", -14, -60, 0, 0.5f, "dB");
    b.add(revLowcut, "rev.lowcut", "reverb", "ローカット", 300, 50, 1000, 10, "Hz");
    b.add(revHicut, "rev.hicut", "reverb", "ハイカット", 9000, 2000, 18000, 100, "Hz");
    b.add(revReturn, "rev.return", "reverb", "リターン", 0, -30, 6, 0.5f, "dB");
    b.tog(dlyBuiltin, "dly.builtin", "delay", "内蔵ディレイを使う", true);
    b.add(dlyBpm, "dly.bpm", "delay", "BPM (Tでタップ)", 120, 50, 240, 0.5f, "", G);
    b.choice(dlyDiv, "dly.div", "delay", "音価", 2, { "16分", "8分", "付点8分", "4分", "付点4分", "2分" });
    b.add(dlySend, "dly.send", "delay", "常時センド", -30, -60, 0, 0.5f, "dB");
    b.add(dlyFb, "dly.fb", "delay", "フィードバック", 28, 0, 85, 1, "%");
    b.add(dlyLowcut, "dly.lowcut", "delay", "ローカット", 350, 50, 1500, 10, "Hz");
    b.add(dlyHicut, "dly.hicut", "delay", "ハイカット", 5000, 1500, 16000, 100, "Hz");
    b.add(dlyReturn, "dly.return", "delay", "リターン", 0, -30, 6, 0.5f, "dB");
    b.tog(throwOn, "throw.on", "throw", "自動スロー", true);
    b.add(throwAmount, "throw.amount", "throw", "スロー時センド", -8, -60, 0, 0.5f, "dB");
    b.add(throwRev, "throw.rev", "throw", "スロー時リバーブ追加", -60, -60, 0, 0.5f, "dB");
    b.add(throwThr, "throw.thr", "throw", "検出スレッショルド", -42, -70, -15, 1, "dB", G);
    b.add(throwMinPhrase, "throw.minPhrase", "throw", "最短フレーズ長", 700, 0, 4000, 50, "ms");
    b.add(throwGap, "throw.gap", "throw", "フレーズ終わり判定", 160, 50, 600, 10, "ms");
    b.add(throwHold, "throw.hold", "throw", "拾う長さ", 260, 50, 800, 10, "ms");
    b.add(dblSend, "dbl.send", "doubler", "センド", -60, -60, 0, 0.5f, "dB");
    b.add(dblDepth, "dbl.depth", "doubler", "揺らぎ", 1.5f, 0, 5, 0.1f, "ms");
    b.add(mTrim, "m.trim", "music", "入力トリム", 0, -24, 24, 0.5f, "dB", G);
    b.tog(mAuto, "m.auto", "music", "オートゲイン", true, G);
    b.tog(mFreeze, "m.freeze", "music", "オートゲインを固定", false, G);
    b.add(mTarget, "m.target", "music", "目標ラウドネス", -18, -30, -8, 0.5f, "LUFS", G);
    b.add(mLowcut, "m.lowcut", "music", "ローカット", 20, 20, 200, 1, "Hz");
    b.add(mLo, "m.lo", "music", "Low シェルフ", 0, -12, 12, 0.5f, "dB");
    b.add(mHi, "m.hi", "music", "High シェルフ", 0, -12, 12, 0.5f, "dB");
    b.add(mFader, "m.fader", "mfader", "フェーダー", -3, -60, 12, 0.5f, "dB");
    b.tog(mMute, "m.mute", "mfader", "ミュート", false, G);
    b.add(carveDepth, "carve.depth", "carve", "深さ", 3, 0, 9, 0.5f, "dB");
    b.add(carveFreq, "carve.freq", "carve", "周波数", 2500, 800, 6000, 10, "Hz");
    b.add(carveQ, "carve.q", "carve", "Q", 0.8f, 0.3f, 4, 0.1f);
    b.add(carveThr, "carve.thr", "carve", "歌唱検出レベル", -42, -70, -15, 1, "dB", G);
    b.add(mstGlueThr, "mst.glue.thr", "master", "バスコンプ スレッショルド", -14, -40, 0, 0.5f, "dB");
    b.add(mstGlueRatio, "mst.glue.ratio", "master", "バスコンプ レシオ", 2, 1, 10, 0.1f, ":1");
    b.add(mstDrive, "mst.drive", "master", "リミッターへの入力", 2, -12, 12, 0.5f, "dB");
    b.add(mstCeiling, "mst.ceiling", "master", "シーリング", -1, -6, 0, 0.1f, "dBFS", G);
    b.add(mstRelease, "mst.release", "master", "リミッター リリース", 80, 10, 500, 5, "ms", G);
    b.add(sysComp, "sys.comp", "latency", "伴奏の遅延補正 (手動分)", 0, 0, 300, 1, "ms", G).hint =
        juce::String::fromUTF8("モニター往復レイテンシ分、配信側の伴奏を遅らせて歌とズレないようにする。ボーカル系プラグインのレイテンシは自動で加算されます");
    b.choice(monSource, "mon.source", "monitor", "モニターの中身", 0, { "モニター用ミックス", "配信ミックスそのもの" }, G);
    b.choice(monVTap, "mon.vtap", "monitor", "自分の声の取り出し位置", 1, { "VSTの前 (低遅延)", "VSTの後" }, G).hint =
        juce::String::fromUTF8("レイテンシの大きいプラグインを挿すときは「VSTの前」にすると歌いやすい");
    b.add(monVocal, "mon.vocal", "monitor", "自分の声", 0, -60, 12, 0.5f, "dB", G);
    b.add(monMusic, "mon.music", "monitor", "伴奏", -4, -60, 12, 0.5f, "dB", G);
    b.add(monFx, "mon.fx", "monitor", "リバーブ/ディレイ", -3, -60, 12, 0.5f, "dB", G);
    b.add(monLevel, "mon.level", "monitor", "モニター音量", -6, -60, 6, 0.5f, "dB", G);
    b.add(sysXfade, "sys.xfade", "monitor", "シーン切替時間", 1.2f, 0, 8, 0.1f, "s", G);
    for (int i = 0; i < kNumParams; ++i) jassert(b.v[(size_t) i].index == i && b.v[(size_t) i].id.isNotEmpty());
    return b.v;
}

std::vector<GroupDef> buildGroups() {
    auto u = [](const char* s) { return juce::String::fromUTF8(s); };
    return {
        { "input", u("マイク入力"), "vocal", -1, true },
        { "gate", u("ゲート / エキスパンダー"), "vocal" },
        { "comp1", u("コンプ① ピーク (速い)"), "vocal" },
        { "eq", u("EQ"), "vocal" },
        { "deess", u("ディエッサー"), "vocal" },
        { "sat", u("サチュレーション"), "vocal" },
        { "comp2", u("コンプ② レベリング (遅い)"), "vocal" },
        { "vins", u("ボーカル・インサート (VST)"), "vocal", chainVocal, true },
        { "rider", u("オートライダー (音量オートメーション)"), "vocal", -1, true },
        { "vocal", u("ボーカル・フェーダー"), "vocal", -1, true },
        { "reverb", u("AUX A: リバーブ"), "fx", chainAuxA, true },
        { "delay", u("AUX B: ディレイ"), "fx", chainAuxB },
        { "throw", u("オート・スロー (語尾ディレイ)"), "fx", -1, true },
        { "doubler", u("ダブラー"), "fx" },
        { "music", u("伴奏"), "music", -1, true },
        { "mins", u("伴奏インサート (VST・キー変更など)"), "music", chainMusic, true },
        { "mfader", u("伴奏フェーダー"), "music", -1, true },
        { "carve", u("ボーカル帯域カーブ (ダイナミックEQ)"), "music" },
        { "mins2", u("マスター・インサート (VST)"), "master", chainMaster, false },
        { "master", u("マスター (配信へ)"), "master", -1, true },
        { "latency", u("遅延補正"), "master", -1, true },
        { "monitor", u("モニター (イヤホン)"), "master", -1, true },
    };
}
} // namespace

const std::vector<ParamDef>& paramDefs() {
    static const auto v = build();
    return v;
}
const std::vector<GroupDef>& groupDefs() {
    static const auto v = buildGroups();
    return v;
}
const ParamDef& def(int id) { return paramDefs()[(size_t) id]; }

int findParam(const juce::String& id) {
    for (auto& p : paramDefs())
        if (p.id == id) return p.index;
    return -1;
}

std::vector<Scene> defaultScenes() {
    struct O { const char* name; std::vector<std::pair<ParamId, float>> over; };
    const std::vector<O> list = {
        { "スタンダード", {} },
        { "バラード", { { revType, 1 }, { revDecay, 2.8f }, { revSend, -11 }, { revPre, 45 }, { dlyDiv, 3 }, { dlySend, -26 }, { dlyFb, 35 },
                        { c2Thr, -24 }, { c2Ratio, 2 }, { satMix, 12 }, { mFader, -5 }, { throwAmount, -6 }, { throwMinPhrase, 1000 } } },
        { "アップテンポ", { { revType, 0 }, { revDecay, 1.2f }, { revSend, -18 }, { dlyDiv, 1 }, { dlySend, -32 }, { dlyFb, 22 },
                          { c1Thr, -19 }, { satMix, 32 }, { satDrive, 8 }, { eqM2G, 3 }, { carveDepth, 4 }, { throwMinPhrase, 500 } } },
        { "サビ (厚く)", { { dblSend, -14 }, { revSend, -12 }, { vFader, 1 }, { eqHiG, 3.5f }, { carveDepth, 4.5f }, { riderOffset, 1 } } },
        { "しっとり / ウィスパー", { { revType, 3 }, { revDecay, 1.6f }, { revSend, -15 }, { c1Thr, -20 }, { c2Ratio, 3 }, { dsThr, -34 },
                                   { gateRange, 6 }, { satMix, 8 }, { eqLoG, 1.5f }, { mFader, -6 }, { dlySend, -60 } } },
        { "MC / トーク", { { revSend, -36 }, { dlySend, -60 }, { throwOn, 0 }, { dblSend, -60 }, { satMix, 0 }, { riderOn, 0 }, { gateRange, 20 },
                          { mFader, -20 }, { carveDepth, 6 }, { c1Thr, -20 } } },
    };
    std::vector<Scene> out;
    for (auto& o : list) {
        Scene s;
        s.name = juce::String::fromUTF8(o.name);
        s.values.resize((size_t) kNumParams);
        for (auto& p : paramDefs()) s.values[(size_t) p.index] = p.def;
        for (auto& [k, v] : o.over) s.values[(size_t) k] = v;
        out.push_back(std::move(s));
    }
    return out;
}

double noteSeconds(double bpm, int divIndex) {
    static const double table[] = { 0.25, 0.5, 0.75, 1, 1.5, 2 };
    return 60.0 / bpm * table[juce::jlimit(0, 5, divIndex)];
}

} // namespace ul
