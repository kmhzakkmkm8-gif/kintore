// パラメータ定義。UI 生成・シーン保存・エンジン適用はすべてこの表から行う。
// scene:false のものは「その日のセッティング」（マイク・機材依存）なのでシーンで切り替わらない。

export const GROUPS = [
  { id: 'input', title: 'マイク入力', strip: 'vocal' },
  { id: 'gate', title: 'ゲート / エキスパンダー', strip: 'vocal' },
  { id: 'comp1', title: 'コンプ① ピーク (速い)', strip: 'vocal' },
  { id: 'eq', title: 'EQ', strip: 'vocal' },
  { id: 'deess', title: 'ディエッサー', strip: 'vocal' },
  { id: 'sat', title: 'サチュレーション', strip: 'vocal' },
  { id: 'comp2', title: 'コンプ② レベリング (遅い)', strip: 'vocal' },
  { id: 'rider', title: 'オートライダー (音量オートメーション)', strip: 'vocal' },
  { id: 'vocal', title: 'ボーカル・フェーダー', strip: 'vocal' },
  { id: 'reverb', title: 'リバーブ', strip: 'fx' },
  { id: 'delay', title: 'ディレイ', strip: 'fx' },
  { id: 'throw', title: 'オート・スロー (語尾ディレイ)', strip: 'fx' },
  { id: 'doubler', title: 'ダブラー', strip: 'fx' },
  { id: 'music', title: '伴奏', strip: 'music' },
  { id: 'carve', title: 'ボーカル帯域カーブ (ダイナミックEQ)', strip: 'music' },
  { id: 'master', title: 'マスター (配信へ)', strip: 'master' },
  { id: 'monitor', title: 'モニター (イヤホン)', strip: 'master' },
];

const p = (id, group, label, def, min, max, step, unit = '', extra = {}) => ({ id, group, label, def, min, max, step, unit, scene: true, ...extra });
const sel = (id, group, label, def, options, extra = {}) => ({ id, group, label, def, type: 'select', options, scene: true, ...extra });
const tog = (id, group, label, def, extra = {}) => ({ id, group, label, def, type: 'toggle', min: 0, max: 1, step: 1, scene: true, ...extra });
const G = { scene: false };

export const PARAMS = [
  // 入力
  p('in.trim', 'input', '入力ゲイン', 0, -20, 30, 0.5, 'dB', G),
  sel('in.channel', 'input', '入力チャンネル', 'L', [['L', 'IN 1 (L)'], ['R', 'IN 2 (R)'], ['mix', 'L+R']], G),
  p('v.hpf', 'input', 'ローカット', 90, 20, 300, 1, 'Hz'),
  // ゲート
  p('gate.thr', 'gate', 'スレッショルド', -55, -90, -20, 1, 'dB', G),
  p('gate.range', 'gate', 'レンジ (0で無効)', 12, 0, 40, 1, 'dB'),
  p('gate.release', 'gate', 'リリース', 150, 20, 1000, 5, 'ms'),
  // コンプ1
  p('c1.thr', 'comp1', 'スレッショルド', -16, -50, 0, 0.5, 'dB'),
  p('c1.ratio', 'comp1', 'レシオ', 4, 1, 20, 0.1, ':1'),
  p('c1.attack', 'comp1', 'アタック', 2, 0.1, 50, 0.1, 'ms'),
  p('c1.release', 'comp1', 'リリース', 60, 10, 500, 1, 'ms'),
  p('c1.makeup', 'comp1', 'メイクアップ', 3, -6, 18, 0.5, 'dB'),
  // EQ
  p('eq.lo.f', 'eq', 'Low 周波数', 120, 40, 400, 1, 'Hz'),
  p('eq.lo.g', 'eq', 'Low (シェルフ)', 0, -12, 12, 0.5, 'dB'),
  p('eq.m1.f', 'eq', 'こもり 周波数', 350, 150, 1200, 5, 'Hz'),
  p('eq.m1.g', 'eq', 'こもり (ベル)', -2.5, -12, 12, 0.5, 'dB'),
  p('eq.m1.q', 'eq', 'こもり Q', 1.2, 0.3, 6, 0.1),
  p('eq.m2.f', 'eq', '抜け 周波数', 3200, 1000, 8000, 10, 'Hz'),
  p('eq.m2.g', 'eq', '抜け (ベル)', 2, -12, 12, 0.5, 'dB'),
  p('eq.m2.q', 'eq', '抜け Q', 0.9, 0.3, 6, 0.1),
  p('eq.hi.f', 'eq', 'Air 周波数', 11000, 5000, 18000, 100, 'Hz'),
  p('eq.hi.g', 'eq', 'Air (シェルフ)', 2.5, -12, 12, 0.5, 'dB'),
  // ディエッサー
  p('ds.freq', 'deess', '検出周波数', 6500, 3000, 11000, 50, 'Hz'),
  p('ds.thr', 'deess', 'スレッショルド', -28, -60, 0, 0.5, 'dB'),
  p('ds.max', 'deess', '最大リダクション', 8, 0, 20, 0.5, 'dB'),
  // サチュ
  p('sat.drive', 'sat', 'ドライブ', 6, 0, 24, 0.5, 'dB'),
  p('sat.mix', 'sat', 'ミックス', 20, 0, 100, 1, '%'),
  // コンプ2
  p('c2.thr', 'comp2', 'スレッショルド', -22, -50, 0, 0.5, 'dB'),
  p('c2.ratio', 'comp2', 'レシオ', 2.5, 1, 10, 0.1, ':1'),
  p('c2.attack', 'comp2', 'アタック', 15, 1, 100, 1, 'ms'),
  p('c2.release', 'comp2', 'リリース', 250, 30, 2000, 10, 'ms'),
  p('c2.makeup', 'comp2', 'メイクアップ', 3, -6, 18, 0.5, 'dB'),
  // ライダー
  tog('rider.on', 'rider', '有効', 1),
  p('rider.offset', 'rider', '伴奏に対する目標差', 0, -12, 12, 0.5, 'dB'),
  p('rider.range', 'rider', '可動範囲 ±', 6, 0, 12, 0.5, 'dB'),
  p('rider.speed', 'rider', '追従速度', 400, 50, 3000, 10, 'ms'),
  p('rider.floor', 'rider', '歌唱検出レベル', -50, -80, -20, 1, 'dB', G),
  // ボーカル
  p('v.fader', 'vocal', 'フェーダー', 0, -60, 12, 0.5, 'dB'),
  tog('v.mute', 'vocal', 'ミュート', 0, G),
  // リバーブ
  sel('rev.type', 'reverb', 'タイプ', 'plate', [['plate', 'プレート'], ['hall', 'ホール'], ['room', 'ルーム'], ['chamber', 'チェンバー']]),
  p('rev.decay', 'reverb', '残響時間', 1.8, 0.3, 6, 0.1, 's'),
  p('rev.pre', 'reverb', 'プリディレイ', 30, 0, 150, 1, 'ms'),
  p('rev.send', 'reverb', 'センド', -14, -60, 0, 0.5, 'dB'),
  p('rev.lowcut', 'reverb', 'ローカット', 300, 50, 1000, 10, 'Hz'),
  p('rev.hicut', 'reverb', 'ハイカット', 9000, 2000, 18000, 100, 'Hz'),
  p('rev.return', 'reverb', 'リターン', 0, -30, 6, 0.5, 'dB'),
  // ディレイ
  p('dly.bpm', 'delay', 'BPM（Tでタップ）', 120, 50, 240, 0.5, '', G),
  sel('dly.div', 'delay', '音価', '1/8.', [['1/16', '16分'], ['1/8', '8分'], ['1/8.', '付点8分'], ['1/4', '4分'], ['1/4.', '付点4分'], ['1/2', '2分']]),
  p('dly.send', 'delay', '常時センド', -30, -60, 0, 0.5, 'dB'),
  p('dly.fb', 'delay', 'フィードバック', 28, 0, 85, 1, '%'),
  p('dly.lowcut', 'delay', 'ローカット', 350, 50, 1500, 10, 'Hz'),
  p('dly.hicut', 'delay', 'ハイカット', 5000, 1500, 16000, 100, 'Hz'),
  p('dly.return', 'delay', 'リターン', 0, -30, 6, 0.5, 'dB'),
  // スロー
  tog('throw.on', 'throw', '自動スロー', 1),
  p('throw.amount', 'throw', 'スロー時センド', -8, -40, 0, 0.5, 'dB'),
  p('throw.rev', 'throw', 'スロー時リバーブ追加', -60, -60, 0, 0.5, 'dB'),
  p('throw.thr', 'throw', '検出スレッショルド', -42, -70, -15, 1, 'dB', G),
  p('throw.minPhrase', 'throw', '最短フレーズ長', 700, 0, 4000, 50, 'ms'),
  p('throw.gap', 'throw', 'フレーズ終わり判定', 160, 50, 600, 10, 'ms'),
  p('throw.hold', 'throw', '拾う長さ', 260, 50, 800, 10, 'ms'),
  // ダブラー
  p('dbl.send', 'doubler', 'センド', -60, -60, 0, 0.5, 'dB'),
  p('dbl.depth', 'doubler', '揺らぎ', 1.5, 0, 5, 0.1, 'ms'),
  // 伴奏
  p('m.trim', 'music', '入力トリム', 0, -24, 24, 0.5, 'dB', G),
  tog('m.auto', 'music', 'オートゲイン', 1, G),
  tog('m.freeze', 'music', 'オートゲインを固定', 0, G),
  p('m.target', 'music', '目標ラウドネス', -18, -30, -8, 0.5, 'LUFS', G),
  p('m.lowcut', 'music', 'ローカット', 20, 20, 200, 1, 'Hz'),
  p('m.lo', 'music', 'Low シェルフ', 0, -12, 12, 0.5, 'dB'),
  p('m.hi', 'music', 'High シェルフ', 0, -12, 12, 0.5, 'dB'),
  p('m.fader', 'music', 'フェーダー', -3, -60, 12, 0.5, 'dB'),
  tog('m.mute', 'music', 'ミュート', 0, G),
  // カーブ
  p('carve.depth', 'carve', '深さ', 3, 0, 9, 0.5, 'dB'),
  p('carve.freq', 'carve', '周波数', 2500, 800, 6000, 10, 'Hz'),
  p('carve.q', 'carve', 'Q', 0.8, 0.3, 4, 0.1),
  p('carve.thr', 'carve', '歌唱検出レベル', -42, -70, -15, 1, 'dB', G),
  // マスター
  p('mst.glue.thr', 'master', 'バスコンプ スレッショルド', -14, -40, 0, 0.5, 'dB'),
  p('mst.glue.ratio', 'master', 'バスコンプ レシオ', 2, 1, 10, 0.1, ':1'),
  p('mst.drive', 'master', 'リミッターへの入力', 2, -12, 12, 0.5, 'dB'),
  p('mst.ceiling', 'master', 'シーリング', -1, -6, 0, 0.1, 'dBFS', G),
  p('mst.release', 'master', 'リミッター リリース', 80, 10, 500, 5, 'ms', G),
  p('sys.comp', 'master', '伴奏の遅延補正', 0, 0, 300, 1, 'ms', { scene: false, hint: 'モニター往復レイテンシ分、配信側の伴奏を遅らせて歌とズレないようにする' }),
  // モニター
  sel('mon.source', 'monitor', 'モニターの中身', 'monitor', [['monitor', 'モニター用ミックス'], ['stream', '配信ミックスそのもの']], G),
  p('mon.vocal', 'monitor', '自分の声', 0, -60, 12, 0.5, 'dB', G),
  p('mon.music', 'monitor', '伴奏', -4, -60, 12, 0.5, 'dB', G),
  p('mon.fx', 'monitor', 'リバーブ/ディレイ', -3, -60, 12, 0.5, 'dB', G),
  p('mon.level', 'monitor', 'モニター音量', -6, -60, 6, 0.5, 'dB', G),
  p('sys.xfade', 'monitor', 'シーン切替時間', 1.2, 0, 8, 0.1, 's', G),
];

export const PARAM_MAP = Object.fromEntries(PARAMS.map((x) => [x.id, x]));
export const DEFAULTS = Object.fromEntries(PARAMS.map((x) => [x.id, x.def]));
export const SCENE_KEYS = PARAMS.filter((x) => x.scene).map((x) => x.id);

/** シーン = 既定値に対する差分。ライブPAが曲やセクションごとに切り替える「スナップショット」。 */
const SCENE_OVERRIDES = [
  { name: 'スタンダード', over: {} },
  {
    name: 'バラード',
    over: { 'rev.type': 'hall', 'rev.decay': 2.8, 'rev.send': -11, 'rev.pre': 45, 'dly.div': '1/4', 'dly.send': -26, 'dly.fb': 35,
      'c2.thr': -24, 'c2.ratio': 2, 'sat.mix': 12, 'm.fader': -5, 'throw.amount': -6, 'throw.minPhrase': 1000 },
  },
  {
    name: 'アップテンポ',
    over: { 'rev.type': 'plate', 'rev.decay': 1.2, 'rev.send': -18, 'dly.div': '1/8', 'dly.send': -32, 'dly.fb': 22,
      'c1.thr': -19, 'sat.mix': 32, 'sat.drive': 8, 'eq.m2.g': 3, 'carve.depth': 4, 'throw.minPhrase': 500 },
  },
  {
    name: 'サビ (厚く)',
    over: { 'dbl.send': -14, 'rev.send': -12, 'v.fader': 1, 'eq.hi.g': 3.5, 'carve.depth': 4.5, 'rider.offset': 1 },
  },
  {
    name: 'しっとり / ウィスパー',
    over: { 'rev.type': 'chamber', 'rev.decay': 1.6, 'rev.send': -15, 'c1.thr': -20, 'c2.ratio': 3, 'ds.thr': -34,
      'gate.range': 6, 'sat.mix': 8, 'eq.lo.g': 1.5, 'm.fader': -6, 'dly.send': -60 },
  },
  {
    name: 'MC / トーク',
    over: { 'rev.send': -36, 'dly.send': -60, 'throw.on': 0, 'dbl.send': -60, 'sat.mix': 0, 'rider.on': 0, 'gate.range': 20,
      'm.fader': -20, 'carve.depth': 6, 'c1.thr': -20 },
  },
];

export function defaultScenes() {
  return SCENE_OVERRIDES.map(({ name, over }) => ({
    name,
    values: Object.fromEntries(SCENE_KEYS.map((k) => [k, over[k] ?? DEFAULTS[k]])),
  }));
}

export function noteSeconds(bpm, div) {
  const beat = 60 / bpm;
  const table = { '1/16': 0.25, '1/8': 0.5, '1/8.': 0.75, '1/4': 1, '1/4.': 1.5, '1/2': 2 };
  return beat * (table[div] ?? 0.75);
}

/** 保存データの検証（壊れた/古い値を既定値で補完し範囲内に収める） */
export function sanitizeValues(obj, keys = PARAMS.map((x) => x.id)) {
  const out = {};
  for (const k of keys) {
    const d = PARAM_MAP[k];
    let v = obj?.[k];
    if (d.type === 'select') {
      if (!d.options.some(([val]) => val === v)) v = d.def;
    } else {
      v = Number(v);
      if (!Number.isFinite(v)) v = d.def;
      v = Math.min(d.max, Math.max(d.min, v));
    }
    out[k] = v;
  }
  return out;
}
