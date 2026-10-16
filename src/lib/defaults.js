// 部位の固定リスト
export const MUSCLES = ['胸', '背中', '肩', '二頭', '三頭', '脚前', '脚裏', 'お尻', 'ふくらはぎ', '腹'];

// 1回のトレーニングで1部位あたりの上限（fractional）。Pelland らの解析で頭打ちが約11セット
export const SESSION_SET_CAP = 11;
// 週セット数の目安（推奨下限・経験則上の上限）
export const WEEKLY_SET_MIN = 10;
export const WEEKLY_SET_MAX = 20;

// id は固定にして、初期データの投入を何度実行しても重複しないようにする
// compound: 多関節種目（RIRの目標が単関節と異なる）
export const DEFAULT_EXERCISES = [
  { id: 'squat', name: 'スクワット', primary: ['脚前'], secondary: ['お尻'], stretchFocus: true, compound: true, increment: 5 },
  { id: 'bench', name: 'ベンチプレス', primary: ['胸'], secondary: ['三頭'], stretchFocus: true, compound: true, increment: 2.5 },
  { id: 'latpull', name: 'ラットプルダウン', primary: ['背中'], secondary: ['二頭'], stretchFocus: false, compound: true, increment: 2.5 },
  { id: 'rdl', name: 'ルーマニアンデッドリフト', primary: ['脚裏'], secondary: ['お尻'], stretchFocus: true, compound: true, increment: 5 },
  { id: 'lateral', name: 'サイドレイズ', primary: ['肩'], secondary: [], stretchFocus: false, compound: false, increment: 1 },
  { id: 'inclinecurl', name: 'インクラインダンベルカール', primary: ['二頭'], secondary: [], stretchFocus: true, compound: false, increment: 1 },
  { id: 'legpress', name: 'レッグプレス', primary: ['脚前'], secondary: ['お尻'], stretchFocus: false, compound: true, increment: 5 },
  { id: 'inclinedb', name: 'インクラインダンベルプレス', primary: ['胸'], secondary: ['肩'], stretchFocus: true, compound: true, increment: 2 },
  { id: 'seatedrow', name: 'シーテッドロー', primary: ['背中'], secondary: ['二頭'], stretchFocus: false, compound: true, increment: 2.5 },
  { id: 'seatedlegcurl', name: 'シーテッドレッグカール', primary: ['脚裏'], secondary: [], stretchFocus: true, compound: false, increment: 2.5 },
  { id: 'ohext', name: 'オーバーヘッドトライセプスエクステンション', primary: ['三頭'], secondary: [], stretchFocus: true, compound: false, increment: 2.5 },
  { id: 'calf', name: 'カーフレイズ（下で一時停止）', primary: ['ふくらはぎ'], secondary: [], stretchFocus: true, compound: false, increment: 5 },
  // 差し替え用
  { id: 'dbbench', name: 'ダンベルベンチプレス', primary: ['胸'], secondary: ['三頭'], stretchFocus: true, compound: true, increment: 2 },
  { id: 'chestpress', name: 'チェストプレス（マシン）', primary: ['胸'], secondary: ['三頭'], stretchFocus: false, compound: true, increment: 2.5 },
  { id: 'cablefly', name: 'ケーブルフライ', primary: ['胸'], secondary: [], stretchFocus: true, compound: false, increment: 2.5 },
  { id: 'pullup', name: '懸垂（アシスト可）', primary: ['背中'], secondary: ['二頭'], stretchFocus: true, compound: true, increment: 2.5 },
  { id: 'dbrow', name: 'ワンハンドダンベルロー', primary: ['背中'], secondary: ['二頭'], stretchFocus: false, compound: true, increment: 2 },
  { id: 'shoulderpress', name: 'ショルダープレス', primary: ['肩'], secondary: ['三頭'], stretchFocus: false, compound: true, increment: 2 },
  { id: 'cablelateral', name: 'ケーブルサイドレイズ', primary: ['肩'], secondary: [], stretchFocus: true, compound: false, increment: 1.25 },
  { id: 'pushdown', name: 'トライセプスプッシュダウン', primary: ['三頭'], secondary: [], stretchFocus: false, compound: false, increment: 2.5 },
  { id: 'hammercurl', name: 'ハンマーカール', primary: ['二頭'], secondary: [], stretchFocus: false, compound: false, increment: 1 },
  { id: 'hacksquat', name: 'ハックスクワット', primary: ['脚前'], secondary: ['お尻'], stretchFocus: true, compound: true, increment: 5 },
  { id: 'bulgarian', name: 'ブルガリアンスクワット', primary: ['脚前', 'お尻'], secondary: [], stretchFocus: true, compound: true, increment: 2 },
  { id: 'legext', name: 'レッグエクステンション', primary: ['脚前'], secondary: [], stretchFocus: false, compound: false, increment: 2.5 },
  { id: 'lyinglegcurl', name: 'ライイングレッグカール', primary: ['脚裏'], secondary: [], stretchFocus: false, compound: false, increment: 2.5 },
  { id: 'hipthrust', name: 'ヒップスラスト', primary: ['お尻'], secondary: ['脚裏'], stretchFocus: false, compound: true, increment: 5 },
  { id: 'cablecrunch', name: 'ケーブルクランチ', primary: ['腹'], secondary: [], stretchFocus: true, compound: false, increment: 2.5 },
];

export const DEFAULT_PROGRAM = {
  id: 'fullbody-ab',
  name: '全身A/B（週3回）',
  active: true,
  days: [
    {
      label: 'A',
      items: [
        { exerciseId: 'squat', sets: 3, repMin: 6, repMax: 10 },
        { exerciseId: 'bench', sets: 3, repMin: 6, repMax: 10 },
        { exerciseId: 'latpull', sets: 3, repMin: 8, repMax: 12 },
        { exerciseId: 'rdl', sets: 2, repMin: 8, repMax: 12 },
        { exerciseId: 'lateral', sets: 2, repMin: 12, repMax: 20 },
        { exerciseId: 'inclinecurl', sets: 2, repMin: 10, repMax: 15 },
      ],
    },
    {
      label: 'B',
      items: [
        { exerciseId: 'legpress', sets: 3, repMin: 10, repMax: 15 },
        { exerciseId: 'inclinedb', sets: 3, repMin: 8, repMax: 12 },
        { exerciseId: 'seatedrow', sets: 3, repMin: 8, repMax: 12 },
        { exerciseId: 'seatedlegcurl', sets: 2, repMin: 10, repMax: 15 },
        { exerciseId: 'ohext', sets: 2, repMin: 10, repMax: 15 },
        { exerciseId: 'calf', sets: 2, repMin: 10, repMax: 15 },
      ],
    },
  ],
};

export function defaultSettings(today) {
  return {
    heightCm: 172,
    targetProteinPerKg: 1.6,
    targetGainPerWeekKg: 0.25,
    targetKcal: 2600,
    restSeconds: 120,
    programStartDate: today,
    deloadUntil: null,
  };
}

export const DEFAULT_FOODS = [
  { id: 'protein-shake', name: 'プロテイン1杯（牛乳200ml）', kcal: 250, protein: 27 },
  { id: 'rice-bowl', name: 'ご飯 大盛り（300g）', kcal: 470, protein: 7 },
  { id: 'eggs2', name: '卵 2個', kcal: 150, protein: 12 },
];

export const REVIEW_PROMPT = `あなたは筋肥大を目的としたトレーニングと増量のコーチです。
貼り付ける週次JSONをもとに、次の順で短く答えてください。

1. 増量ペース：7日平均体重の変化を、目標（週0.13〜0.25kg）と比べて判定。外れていれば目標kcalを±100〜150kcalで調整
2. タンパク質：平均が体重×1.6gに届いているか
3. ボリューム：部位ごとの週セット数（0.5換算）の過不足
4. 進捗：種目ごとに、ダブルプログレッションのルールで次回の重量と回数を提示
5. 停滞・疲労：2回連続で伸びない種目や、疲労・睡眠の悪化があれば、セット増減かディロードを提案

根拠のある提案と経験則による提案は区別して書くこと。`;
