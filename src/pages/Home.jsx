import { useMemo, useState } from 'react';
import { useData } from '../lib/store.jsx';
import { navigate } from '../lib/nav.js';
import { addDays, fromKey, todayKey, weekStart, weekdayLabel } from '../lib/dates.js';
import {
  exerciseHistory,
  movingAverage,
  nextDayLabel,
  nutritionTotals,
  plannedMuscleLoad,
  programWeek,
  proteinTarget,
  targetRir,
  trendStatus,
} from '../lib/calc.js';
import { SESSION_SET_CAP } from '../lib/defaults.js';
import { buildDraft, loadDraft, saveDraft } from '../lib/workout.js';
import { Button, Card, NumberInput, ProgressBar } from '../components/ui.jsx';

export default function Home() {
  const data = useData();
  const { settings, activeProgram, sessions, exMap, bodyweight, nutrition } = data;
  const today = todayKey();
  const week = programWeek(settings.programStartDate, today);
  const deload = settings.deloadUntil && settings.deloadUntil >= today;
  const draft = loadDraft();

  const suggested = nextDayLabel(sessions, activeProgram);
  const [dayLabel, setDayLabel] = useState(suggested);
  const day = activeProgram?.days.find((d) => d.label === dayLabel);
  const doneToday = sessions.some((s) => s.date === today);
  const weekCount = sessions.filter((s) => s.date >= weekStart(today) && s.date <= today).length;

  const start = () => {
    saveDraft(buildDraft({ program: activeProgram, dayLabel, date: today, sessions, exMap, deload }));
    navigate('/workout');
  };

  // 体重
  const todayKg = bodyweight[today] ?? null;
  const ma = movingAverage(bodyweight, today);
  const maPrev = movingAverage(bodyweight, addDays(today, -7));
  const weightRef = ma ?? maPrev ?? 50;

  // 食事
  const n = nutritionTotals(nutrition[today]);
  const pTarget = proteinTarget(settings, weightRef);

  // 3回連続で記録が落ちた種目 → ディロード提案
  const declining = useMemo(() => {
    const ids = new Set(sessions.flatMap((s) => (s.sets || []).map((x) => x.exerciseId)));
    return [...ids].filter((id) => exMap[id] && trendStatus(exerciseHistory(sessions, id)) === 'decline');
  }, [sessions, exMap]);

  const load = day ? plannedMuscleLoad(day.items, exMap) : {};
  const over = Object.entries(load).filter(([, v]) => v > SESSION_SET_CAP);

  return (
    <div className="space-y-3">
      <header className="flex items-end justify-between pt-2">
        <div>
          <div className="text-slate-400 text-sm">
            {fromKey(today).getMonth() + 1}月{fromKey(today).getDate()}日（{weekdayLabel(today)}）
          </div>
          <h1 className="text-xl font-bold">プログラム {week}週目</h1>
        </div>
        <div className="text-right text-xs text-slate-400">
          {week <= 2 ? '全セット RIR 3（フォーム習得）' : '多関節 RIR1〜2 / 単関節 RIR0〜1'}
        </div>
      </header>

      {deload && (
        <div className="rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-200 text-sm p-3 flex items-center justify-between gap-2">
          <span>ディロード中（{settings.deloadUntil}まで）：セット数を半分にします</span>
          <button type="button" className="underline text-xs shrink-0" onClick={() => data.saveSettings({ deloadUntil: null })}>
            解除
          </button>
        </div>
      )}
      {!deload && declining.length > 0 && (
        <div className="rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-sm p-3 space-y-2">
          <div>
            3回連続で記録が落ちています：{declining.map((id) => exMap[id].name).join('、')}
            。疲労が強ければ1週間ディロード（セット数半分）を検討。
            <span className="text-amber-300/70">（経験則）</span>
          </div>
          <Button className="text-xs py-1.5" onClick={() => data.saveSettings({ deloadUntil: addDays(today, 6) })}>
            今日から1週間ディロードにする
          </Button>
        </div>
      )}

      <Card
        title={draft ? 'トレーニング中' : `今日のメニュー`}
        right={
          !draft &&
          activeProgram && (
            <div className="flex flex-wrap justify-end gap-1">
              {activeProgram.days.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setDayLabel(d.label)}
                  className={`min-w-9 h-9 px-2 rounded-lg font-bold text-sm ${dayLabel === d.label ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )
        }
      >
        {draft ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              {draft.date} {draft.dayLabel ? `${draft.dayLabel}の日` : ''}の記録が途中です。
            </p>
            <Button variant="primary" className="w-full" onClick={() => navigate('/workout')}>
              続きを記録する
            </Button>
          </div>
        ) : !day ? (
          <p className="text-sm text-slate-400">設定でプログラムを作成してください。</p>
        ) : (
          <div className="space-y-3">
            {doneToday && <p className="text-xs text-emerald-400">今日のトレーニングは記録済みです。</p>}
            <p className="text-xs text-slate-400">
              {dayLabel === suggested ? '前回の続き（順番に回す）' : `次の予定は${suggested}の日`}
              {' ・ '}今週{weekCount}回{doneToday ? '' : `（今日で${weekCount + 1}回目）`}
            </p>
            <ul className="divide-y divide-slate-800">
              {day.items.map((it, i) => {
                const ex = exMap[it.exerciseId];
                return (
                  <li key={i} className="py-2 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">
                      {ex?.name || '（削除された種目）'}
                      {ex?.stretchFocus && <span className="ml-1 text-[10px] text-sky-300">伸張位</span>}
                    </span>
                    <span className="text-slate-400 shrink-0 tabular-nums">
                      {deload ? Math.max(1, Math.ceil(it.sets / 2)) : it.sets}×{it.repMin}〜{it.repMax}
                      <span className="ml-2 text-[11px]">{targetRir(ex, week).label}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {over.length > 0 && (
              <p className="text-xs text-amber-300">
                ⚠ 1回で11セット超：{over.map(([m, v]) => `${m} ${v}`).join('、')}（筋肥大の頭打ち付近）
              </p>
            )}
            <Button variant="primary" className="w-full text-lg" onClick={start}>
              {dayLabel}の日を始める
            </Button>
          </div>
        )}
      </Card>

      <Card title="今日の食事" right={<a href="#/food" className="text-xs text-emerald-400">記録する →</a>}>
        <div className="space-y-3">
          <Macro label="カロリー" value={n.kcal} target={settings.targetKcal} unit="kcal" />
          <Macro label="タンパク質" value={n.protein} target={pTarget} unit="g" color="bg-sky-500" />
        </div>
      </Card>

      <WeightCard todayKg={todayKg} ma={ma} maPrev={maPrev} onSave={(kg) => data.setBodyweight(today, kg)} />
    </div>
  );
}

function Macro({ label, value, target, unit, color }) {
  const rest = target - value;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums">
          {value} / {target}
          {unit}
          <span className={`ml-2 text-xs ${rest > 0 ? 'text-slate-400' : 'text-emerald-400'}`}>
            {rest > 0 ? `残り${rest}` : '達成'}
          </span>
        </span>
      </div>
      <ProgressBar value={value} target={target} color={color} />
    </div>
  );
}

function WeightCard({ todayKg, ma, maPrev, onSave }) {
  const [kg, setKg] = useState(todayKg);
  const diff = ma != null && maPrev != null ? ma - maPrev : null;
  return (
    <Card title="今朝の体重" right={<span className="text-[11px] text-slate-500">起床・トイレ後</span>}>
      <div className="flex gap-2 items-center">
        <NumberInput value={kg} onChange={setKg} step="0.1" placeholder="50.0" className="text-lg font-bold" />
        <span className="text-slate-400">kg</span>
        <Button variant="primary" onClick={() => onSave(kg)} disabled={kg === todayKg}>
          保存
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
        <div className="rounded-xl bg-slate-800/60 p-2">
          <div className="text-[11px] text-slate-400">7日平均</div>
          <div className="font-bold tabular-nums">{ma != null ? ma.toFixed(2) : '—'} kg</div>
        </div>
        <div className="rounded-xl bg-slate-800/60 p-2">
          <div className="text-[11px] text-slate-400">先週比（目標 +0.13〜0.25）</div>
          <div
            className={`font-bold tabular-nums ${
              diff == null ? '' : diff < 0.13 ? 'text-amber-300' : diff > 0.25 ? 'text-rose-300' : 'text-emerald-400'
            }`}
          >
            {diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} kg` : '—'}
          </div>
        </div>
      </div>
    </Card>
  );
}
