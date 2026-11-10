// パラメータ定義（Web 版 src/params.js と同じ ID）。UI 生成・シーン・保存はすべてこの表から。
#pragma once
#include <juce_core/juce_core.h>
#include <array>
#include <vector>

namespace ul {

enum ParamId : int {
    inTrim, inChannel, inSum, vHpf,
    gateThr, gateRange, gateRelease,
    c1On, c1Thr, c1Ratio, c1Attack, c1Release, c1Makeup,
    eqOn, eqLoF, eqLoG, eqM1F, eqM1G, eqM1Q, eqM2F, eqM2G, eqM2Q, eqHiF, eqHiG,
    dsOn, dsFreq, dsThr, dsMax,
    satDrive, satMix,
    c2On, c2Thr, c2Ratio, c2Attack, c2Release, c2Makeup,
    riderOn, riderOffset, riderRange, riderSpeed, riderFloor,
    vFader, vMute,
    revBuiltin, revType, revDecay, revPre, revSend, revLowcut, revHicut, revReturn,
    dlyBuiltin, dlyBpm, dlyDiv, dlySend, dlyFb, dlyLowcut, dlyHicut, dlyReturn,
    throwOn, throwAmount, throwRev, throwThr, throwMinPhrase, throwGap, throwHold,
    dblSend, dblDepth,
    mTrim, mAuto, mFreeze, mTarget, mLowcut, mLo, mHi, mFader, mMute,
    carveDepth, carveFreq, carveQ, carveThr,
    mstGlueThr, mstGlueRatio, mstDrive, mstCeiling, mstRelease, sysComp,
    monSource, monVTap, monVocal, monMusic, monFx, monLevel, sysXfade,
    kNumParams
};

enum class PType { Float, Toggle, Choice };

struct ParamDef {
    ParamId index;
    juce::String id, group, label, unit, hint;
    PType type = PType::Float;
    float def = 0, min = 0, max = 1, step = 0.01f;
    bool scene = true;
    juce::StringArray choices;
};

enum ChainId : int { chainVocal, chainAuxA, chainAuxB, chainMusic, chainMaster, kNumChains };

struct GroupDef {
    juce::String id, title, strip; // strip: vocal / fx / music / master
    int chain = -1;                // プラグインスロットを表示するチェーン
    bool openByDefault = false;
};

const std::vector<ParamDef>& paramDefs();
const std::vector<GroupDef>& groupDefs();
const ParamDef& def(int id);
int findParam(const juce::String& id);

struct Scene {
    juce::String name;
    std::vector<float> values;                                 // kNumParams（scene=false の値は無視）
    std::array<std::array<bool, 6>, kNumChains> bypass {};      // プラグインスロットのバイパス
};
std::vector<Scene> defaultScenes();

double noteSeconds(double bpm, int divIndex);

} // namespace ul
