import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../lib/store.jsx';
import { navigate } from '../lib/nav.js';
import { todayKey } from '../lib/dates.js';
import { nextDayLabel, plannedMuscleLoad, programWeek, targetRir } from '../lib/calc.js';
import { SESSION_SET_CAP } from '../lib/defaults.js';
import { buildDraft, buildItem, draftToSession, loadDraft, reachedTop, saveDraft } from '../lib/workout.js';
import { Button, Card, Chip, Modal, inputCls, useToast } from '../components/ui.jsx';

const RIRS = [0, 1, 2, 3, 4];

export default function Workout() {
  const data = useData();
  const [draft, setDraftState] = useState(loadDraft);
  const [toast, showToast] = useToast();

  const setDraft = (updater) =>
    setDraftState((d) => {
      const next = typeof updater === 'function' ? updater(d) : updater;
      saveDraft(next);
      return next;
    });

  if (!draft) return <StartScreen onStart={setDraft} />;
  return (
    <>
      <ActiveWorkout draft={draft} setDraft={setDraft} showToast={showToast} data={data} />
      {toast}
    </>
  );
}

function StartScreen({ onStart }) {
  const { activeProgram, sessions, exMap, settings } = useData();
  const today = todayKey();
  const [label, setLabel] = useState(nextDayLabel(sessions, activeProgram));
  const deload = settings.deloadUntil && settings.deloadUntil >= today;
  const start = (dayLabel) =>
    onStart(buildDraft({ program: dayLabel ? activeProgram : null, dayLabel, date: today, sessions, exMap, deload }));
  return (
    <div className="space-y-3 pt-2">
      <h1 className="text-xl font-bold">トレーニング</h1>
      <Card title={activeProgram?.name || 'プログラムなし'}>
        <div className="flex gap-2 mb-3">
          {activeProgram?.days.map((d) => (
            <Chip key={d.label} active={label === d.label} onClick={() => setLabel(d.label)}>
              {d.label}の日
            </Chip>
          ))}
        </div>
        <Button variant="primary" className="w-full text-lg" disabled={!label} onClick={() => start(label)}>
          {label}の日を始める
        </Button>
        <Button className="w-full mt-2" onClick={() => start(null)}>
          メニューなしで記録（種目を自分で追加）
        </Button>
      </Card>
    </div>
  );
}

function ActiveWorkout({ draft, setDraft, showToast, data }) {
  const { exMap, settings, sessions } = data;
  const week = programWeek(settings.programStartDate, draft.date);
  const [picker, setPicker] = useState(null); // { mode: 'add' } | { mode: 'swap', index }
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const updateItem = (i, fn) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? fn(it) : it)) }));

  const startRest = () => setDraft((d) => ({ ...d, restEndAt: Date.now() + settings.restSeconds * 1000 }));

  const load = useMemo(
    () =>
      plannedMuscleLoad(
        draft.items.map((it) => ({ exerciseId: it.exerciseId, sets: it.rows.filter((r) => !r.isWarmup).length })),
        exMap,
      ),
    [draft.items, exMap],
  );
  const over = Object.entries(load).filter(([, v]) => v > SESSION_SET_CAP);
  const doneCount = draft.items.reduce((a, it) => a + it.rows.filter((r) => r.done && !r.isWarmup).length, 0);

  const finish = () => {
    const session = draftToSession(draft);
    if (!session.sets.length) {
      showToast('完了したセットがありません');
      return;
    }
    data.saveSession(session);
    setDraft(null);
    navigate('/');
  };

  const pick = (exerciseId) => {
    const ctx = { sessions, exMap, deload: draft.deload };
    if (picker.mode === 'add') {
      setDraft((d) => ({ ...d, items: [...d.items, buildItem({ exerciseId, sets: 3, repMin: 8, repMax: 12 }, ctx)] }));
    } else {
      updateItem(picker.index, (it) =>
        buildItem({ exerciseId, sets: it.planSets, repMin: it.repMin, repMax: it.repMax }, { ...ctx, deload: false }),
      );
    }
    setPicker(null);
  };

  return (
    <div className="space-y-3 pt-2 pb-20">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">
            {draft.dayLabel ? `${draft.dayLabel}の日` : 'フリー'}
            {draft.deload && <span className="ml-2 text-sm text-sky-300">ディロード</span>}
          </h1>
          <div className="text-xs text-slate-400">
            {draft.date} ・ {week}週目 ・ 本番{doneCount}セット完了
          </div>
        </div>
        <p className="text-[11px] text-slate-500 text-right">
          RIRをタップで
          <br />
          セット完了
        </p>
      </header>

      {over.length > 0 && (
        <div className="rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs p-3">
          ⚠ 1回で1部位11セット超（0.5換算）：{over.map(([m, v]) => `${m} ${v}`).join('、')}。これ以上は上乗せが小さい可能性。
        </div>
      )}

      {draft.items.map((it, i) => (
        <ExerciseCard
          key={`${it.exerciseId}-${i}`}
          item={it}
          ex={exMap[it.exerciseId]}
          week={week}
          onChange={(fn) => updateItem(i, fn)}
          onSetDone={startRest}
          onSwap={() => setPicker({ mode: 'swap', index: i })}
          onRemove={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}
          onMove={(dir) =>
            setDraft((d) => {
              const items = [...d.items];
              const j = i + dir;
              if (j < 0 || j >= items.length) return d;
              [items[i], items[j]] = [items[j], items[i]];
              return { ...d, items };
            })
          }
        />
      ))}

      <Button className="w-full" onClick={() => setPicker({ mode: 'add' })}>
        ＋ 種目を追加
      </Button>

      <Card title="体調（任意）">
        <div className="space-y-3">
          <div>
            <div className="text-xs text-slate-400 mb-1">疲労度（1=元気 〜 5=ヘトヘト）</div>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <Chip
                  key={v}
                  active={draft.fatigue === v}
                  className="w-10"
                  onClick={() => setDraft((d) => ({ ...d, fatigue: d.fatigue === v ? null : v }))}
                >
                  {v}
                </Chip>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs text-slate-400 w-20">昨夜の睡眠</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              className={`${inputCls} w-24`}
              value={draft.sleepHours ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, sleepHours: e.target.value === '' ? null : Number(e.target.value) }))}
            />
            時間
          </label>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Button variant="danger" onClick={() => setConfirmDiscard(true)}>
          破棄
        </Button>
        <Button variant="primary" className="col-span-2 text-lg" onClick={finish}>
          完了して保存
        </Button>
      </div>

      <RestTimer
        endAt={draft.restEndAt}
        total={settings.restSeconds}
        onChange={(endAt) => setDraft((d) => ({ ...d, restEndAt: endAt }))}
      />

      {picker && (
        <ExercisePicker
          base={picker.mode === 'swap' ? exMap[draft.items[picker.index].exerciseId] : null}
          onPick={pick}
          onClose={() => setPicker(null)}
        />
      )}
      {confirmDiscard && (
        <Modal title="記録を破棄しますか？" onClose={() => setConfirmDiscard(false)}>
          <p className="text-sm text-slate-400 mb-4">このトレーニングの入力内容は保存されずに消えます。</p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setConfirmDiscard(false)}>戻る</Button>
            <Button
              variant="danger"
              onClick={() => {
                setDraft(null);
                navigate('/');
              }}
            >
              破棄する
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ExerciseCard({ item, ex, week, onChange, onSetDone, onSwap, onRemove, onMove }) {
  const [menu, setMenu] = useState(false);
  const [showNote, setShowNote] = useState(Boolean(item.note));
  const rir = targetRir(ex, week);
  const inc = ex?.increment || 2.5;
  const working = item.rows.filter((r) => !r.isWarmup);
  const allDone = working.length > 0 && working.every((r) => r.done);
  const top = reachedTop(item);

  const setRow = (ri, patch) => onChange((it) => ({ ...it, rows: it.rows.map((r, j) => (j === ri ? { ...r, ...patch } : r)) }));

  const addRow = (isWarmup) =>
    onChange((it) => {
      const ref = isWarmup ? it.rows.find((r) => !r.isWarmup) : [...it.rows].reverse().find((r) => !r.isWarmup);
      const row = {
        weight: isWarmup ? Math.round((ref?.weight || 0) * 0.5 * 2) / 2 : ref?.weight ?? 0,
        reps: isWarmup ? 8 : ref?.reps ?? it.repMin,
        rir: null,
        isWarmup,
        done: false,
      };
      const warmCount = it.rows.filter((r) => r.isWarmup).length;
      const rows = [...it.rows];
      if (isWarmup) rows.splice(warmCount, 0, row);
      else rows.push(row);
      return { ...it, rows };
    });

  let workNo = 0;
  return (
    <Card className={allDone ? 'border-emerald-700/60' : ''}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-bold leading-tight">
            {ex?.name || '（削除された種目）'}
            {ex?.stretchFocus && <span className="ml-1.5 text-[10px] text-sky-300 align-middle">伸張位</span>}
          </h2>
          <div className="text-xs text-slate-400 mt-0.5">
            {item.planSets}×{item.repMin}〜{item.repMax}回 ・ {rir.label}
          </div>
        </div>
        <div className="relative shrink-0">
          <button type="button" className="px-2 py-1 text-slate-400" onClick={() => setMenu((v) => !v)} aria-label="メニュー">
            ⋯
          </button>
          {menu && (
            <div className="absolute right-0 top-8 z-30 w-40 rounded-xl bg-slate-800 border border-slate-700 shadow-xl text-sm overflow-hidden">
              {[
                ['種目を差し替え', onSwap],
                ['上へ移動', () => onMove(-1)],
                ['下へ移動', () => onMove(1)],
                ['メモ', () => setShowNote(true)],
                ['この種目を外す', onRemove],
              ].map(([label, fn]) => (
                <button
                  key={label}
                  type="button"
                  className="block w-full text-left px-3 py-2.5 active:bg-slate-700"
                  onClick={() => {
                    setMenu(false);
                    fn();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="text-xs mt-2 space-y-1">
        {item.prevText ? (
          <div className="text-slate-300">
            <span className="text-slate-500">前回 {item.prevDate?.slice(5).replace('-', '/')}：</span>
            {item.prevText}
          </div>
        ) : (
          <div className="text-slate-500">初回：RIR 3で余裕を持って重さを探る</div>
        )}
        {item.progression.action === 'increase' && (
          <div className="text-emerald-400">
            ⬆ 前回は全セット上限達成 → 今回 {item.progression.nextWeight}kg（+{inc}kg）
          </div>
        )}
        {item.trend === 'stall' && (
          <div className="text-amber-300">停滞：2回連続で伸びていません。部位の週セット+1〜2を検討（経験則）</div>
        )}
        {item.trend === 'decline' && (
          <div className="text-rose-300">3回連続で低下：疲労が強ければディロードを検討（経験則）</div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {item.rows.map((r, ri) => {
          const label = r.isWarmup ? 'W' : String(++workNo);
          return r.done ? (
            <button
              key={ri}
              type="button"
              onClick={() => setRow(ri, { done: false })}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left ${
                r.isWarmup ? 'bg-slate-800/50 text-slate-400' : 'bg-emerald-500/10 text-emerald-100'
              }`}
            >
              <span className="w-6 text-center font-bold text-emerald-400">✓</span>
              <span className="w-5 text-xs text-slate-400">{label}</span>
              <span className="font-bold tabular-nums">
                {r.weight}kg × {r.reps}
              </span>
              <span className="text-sm text-slate-400">@RIR{r.rir >= 4 ? '4+' : r.rir}</span>
              <span className="ml-auto text-[11px] text-slate-500">修正</span>
            </button>
          ) : (
            <div key={ri} className={`rounded-xl p-2 ${r.isWarmup ? 'bg-slate-800/40' : 'bg-slate-800/80'}`}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title="ウォームアップ切替"
                  onClick={() => setRow(ri, { isWarmup: !r.isWarmup })}
                  className={`w-7 h-7 shrink-0 rounded-lg text-xs font-bold ${r.isWarmup ? 'bg-amber-500/30 text-amber-200' : 'bg-slate-700 text-slate-300'}`}
                >
                  {label}
                </button>
                <Stepper
                  value={r.weight}
                  step={inc}
                  unit="kg"
                  onChange={(v) => setRow(ri, { weight: v })}
                  className="flex-[1.25]"
                />
                <Stepper value={r.reps} step={1} unit="回" onChange={(v) => setRow(ri, { reps: v })} className="flex-1" integer />
              </div>
              <div className="grid grid-cols-5 gap-1.5 mt-2">
                {RIRS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setRow(ri, { rir: v, done: true });
                      onSetDone();
                    }}
                    className={`h-10 rounded-lg text-sm font-bold active:bg-emerald-500 active:text-slate-950 ${
                      !r.isWarmup && v >= rir.min && v <= rir.max
                        ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-600/50'
                        : 'bg-slate-700 text-slate-200'
                    }`}
                  >
                    {v === 4 ? '4+' : v}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {top && (
        <div className="mt-3 rounded-xl bg-emerald-500/15 text-emerald-300 text-sm px-3 py-2 font-bold">
          🎉 全セット上限達成 → 次回は重量アップ（+{inc}kg）
        </div>
      )}
      {allDone && !top && working.length >= item.planSets && (
        <div className="mt-3 text-xs text-slate-400">次回は同じ重量で回数を増やす（上限 {item.repMax}回まで）</div>
      )}

      <div className="flex gap-2 mt-3">
        <Button className="flex-1 text-sm py-2" onClick={() => addRow(false)}>
          ＋セット
        </Button>
        <Button className="flex-1 text-sm py-2" onClick={() => addRow(true)}>
          ＋アップ
        </Button>
        <Button className="text-sm py-2" onClick={() => setShowNote((v) => !v)}>
          メモ
        </Button>
      </div>
      {showNote && (
        <input
          className={`${inputCls} mt-2 text-sm`}
          placeholder="フォーム・痛み・マシン設定など"
          value={item.note}
          onChange={(e) => onChange((it) => ({ ...it, note: e.target.value }))}
        />
      )}
    </Card>
  );
}

function Stepper({ value, step, unit, onChange, className = '', integer }) {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const bump = (d) => {
    const v = Math.max(0, Math.round(((Number(value) || 0) + d) * 100) / 100);
    onChange(v);
  };
  return (
    <div className={`flex items-center rounded-lg bg-slate-900 border border-slate-700 overflow-hidden ${className}`}>
      <button type="button" className="w-9 h-10 text-xl text-slate-300 active:bg-slate-700" onClick={() => bump(-step)}>
        −
      </button>
      <input
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? 1 : 0.5}
        className="w-0 flex-1 bg-transparent text-center font-bold text-lg tabular-nums focus:outline-none"
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value !== '') onChange(Number(e.target.value));
        }}
      />
      <span className="text-[10px] text-slate-500 -ml-1 mr-1">{unit}</span>
      <button type="button" className="w-9 h-10 text-xl text-slate-300 active:bg-slate-700" onClick={() => bump(step)}>
        ＋
      </button>
    </div>
  );
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.15);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* 音が出せない環境では無視 */
  }
  navigator.vibrate?.([200, 100, 200]);
}

// 休息タイマー。終了時刻で持つので、画面ロックやタブ切替から戻っても正しく表示される
function RestTimer({ endAt, total, onChange }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(null);
  useEffect(() => {
    if (!endAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [endAt]);

  const remain = endAt ? Math.ceil((endAt - now) / 1000) : null;
  useEffect(() => {
    if (endAt && remain <= 0 && fired.current !== endAt) {
      fired.current = endAt;
      if (remain > -3) beep();
    }
  }, [remain, endAt]);

  if (!endAt) return null;
  const over = remain <= 0;
  const abs = Math.abs(remain);
  const mmss = `${over ? '+' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
  const pct = over ? 100 : ((total - remain) / total) * 100;

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 px-3">
      <div
        className={`max-w-xl mx-auto rounded-2xl border shadow-xl overflow-hidden ${
          over ? 'bg-emerald-600 border-emerald-400 text-slate-950' : 'bg-slate-800 border-slate-700'
        }`}
      >
        <div className="h-1 bg-black/20">
          <div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-xs">{over ? '休息終了' : '休息'}</span>
          <span className="text-2xl font-bold tabular-nums">{mmss}</span>
          <div className="ml-auto flex gap-1.5">
            <button type="button" className="rounded-lg bg-black/20 px-3 py-1.5 text-sm" onClick={() => onChange(Math.max(Date.now(), endAt) + 30000)}>
              +30秒
            </button>
            <button type="button" className="rounded-lg bg-black/20 px-3 py-1.5 text-sm" onClick={() => onChange(null)}>
              {over ? '閉じる' : 'スキップ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExercisePicker({ base, onPick, onClose }) {
  const { exercises } = useData();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const filtered = exercises.filter((e) => !q || e.name.includes(q) || (e.primary || []).some((m) => m.includes(q)));
    if (!base) return filtered;
    const same = (e) => (e.primary || []).some((m) => (base.primary || []).includes(m));
    return [...filtered.filter(same), ...filtered.filter((e) => !same(e))].filter((e) => e.id !== base.id);
  }, [exercises, q, base]);
  return (
    <Modal title={base ? `「${base.name}」を差し替え` : '種目を追加'} onClose={onClose}>
      <input className={`${inputCls} mb-3`} placeholder="種目名・部位で検索" value={q} onChange={(e) => setQ(e.target.value)} />
      {base && <p className="text-xs text-slate-400 mb-2">同じ部位の種目を上に表示しています</p>}
      <ul className="divide-y divide-slate-800">
        {list.map((e) => (
          <li key={e.id}>
            <button type="button" className="w-full text-left py-2.5 active:bg-slate-800" onClick={() => onPick(e.id)}>
              <div className="text-sm">
                {e.name}
                {e.stretchFocus && <span className="ml-1 text-[10px] text-sky-300">伸張位</span>}
              </div>
              <div className="text-[11px] text-slate-500">
                {(e.primary || []).join('・')}
                {e.secondary?.length ? ` ／ 補助 ${e.secondary.join('・')}` : ''}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
