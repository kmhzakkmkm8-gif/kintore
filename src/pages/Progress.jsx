import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../lib/store.jsx';
import { addDays, shortLabel, todayKey, weekStart } from '../lib/dates.js';
import {
  bestE1rm,
  estimateMaintenance,
  exerciseHistory,
  formatSets,
  suggestedKcal,
  weeklySetsByMuscle,
  weightSeries,
} from '../lib/calc.js';
import { MUSCLES, WEEKLY_SET_MAX, WEEKLY_SET_MIN } from '../lib/defaults.js';
import { Button, Card, Chip, Field, Modal, NumberInput, inputCls } from '../components/ui.jsx';

const axis = { stroke: '#64748b', fontSize: 11, tickLine: false };
const tooltipStyle = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 12, fontSize: 12 },
  labelStyle: { color: '#94a3b8' },
};

export default function Progress() {
  return (
    <div className="space-y-3 pt-2">
      <h1 className="text-xl font-bold">進捗</h1>
      <WeightChart />
      <Maintenance />
      <WeeklyVolume />
      <E1rmChart />
      <Measurements />
      <SessionList />
    </div>
  );
}

function WeightChart() {
  const { bodyweight } = useData();
  const [weeks, setWeeks] = useState(8);
  const today = todayKey();
  const series = useMemo(() => weightSeries(bodyweight, addDays(today, -weeks * 7 + 1), today), [bodyweight, today, weeks]);
  const has = series.some((d) => d.kg != null);
  return (
    <Card
      title="体重"
      right={
        <div className="flex gap-1">
          {[4, 8, 26].map((w) => (
            <Chip key={w} active={weeks === w} onClick={() => setWeeks(w)} className="text-xs px-2">
              {w}週
            </Chip>
          ))}
        </div>
      }
    >
      {!has ? (
        <p className="text-sm text-slate-500">ホームで毎朝の体重を記録するとグラフが表示されます</p>
      ) : (
        <div className="h-52 -ml-4">
          <ResponsiveContainer>
            <LineChart data={series}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortLabel} {...axis} minTickGap={24} />
              <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} {...axis} width={44} tickFormatter={(v) => v.toFixed(1)} />
              <Tooltip {...tooltipStyle} formatter={(v, n) => [`${v}kg`, n === 'kg' ? '体重' : '7日平均']} />
              <Line dataKey="kg" stroke="#64748b" dot={{ r: 2, fill: '#64748b' }} strokeWidth={0} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="ma7" stroke="#34d399" dot={false} strokeWidth={2.5} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-1">点＝日々の体重、線＝7日移動平均。目標は週+0.13〜0.25kg</p>
    </Card>
  );
}

function Maintenance() {
  const data = useData();
  const { bodyweight, nutrition, settings } = data;
  // 今日は記録途中なので昨日までの21日で推定
  const est = estimateMaintenance(bodyweight, nutrition, addDays(todayKey(), -1), 21);
  const target = est.ok ? suggestedKcal(est.maintenance, settings.targetGainPerWeekKg) : null;
  return (
    <Card title="維持カロリーの推定" right={<span className="text-[11px] text-slate-500">直近3週間</span>}>
      {!est.ok ? (
        <p className="text-sm text-slate-400">
          kcalの記録が21日中{est.needed}日以上と、体重の記録がそろうと推定できます（現在 {est.daysLogged}日）。
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="平均摂取" value={`${est.avgKcal}`} unit="kcal" />
            <Stat label="体重変化" value={`${est.weeklyGainKg >= 0 ? '+' : ''}${est.weeklyGainKg}`} unit="kg/週" />
            <Stat label="推定維持" value={`${est.maintenance}`} unit="kcal" />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-800/60 p-3">
            <span>
              週+{settings.targetGainPerWeekKg}kgの目標 → <b className="text-emerald-400">{target}kcal</b>
              <span className="text-slate-400 text-xs">（現在 {settings.targetKcal}）</span>
            </span>
            <Button className="text-xs py-1.5 shrink-0" disabled={target === settings.targetKcal} onClick={() => data.saveSettings({ targetKcal: target })}>
              反映
            </Button>
          </div>
          <p className="text-[11px] text-slate-500">7700kcal≒体脂肪1kgとした概算。水分や記録漏れで数百kcalずれます。</p>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="rounded-xl bg-slate-800/60 p-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="font-bold tabular-nums">{value}</div>
      <div className="text-[10px] text-slate-500">{unit}</div>
    </div>
  );
}

function WeeklyVolume() {
  const { sessions, exMap } = useData();
  const [start, setStart] = useState(weekStart(todayKey()));
  const vol = weeklySetsByMuscle(sessions, exMap, start);
  const max = Math.max(WEEKLY_SET_MAX + 2, ...MUSCLES.map((m) => vol[m].effective + vol[m].lowEffort));
  const isThisWeek = start === weekStart(todayKey());
  return (
    <Card
      title="部位別 週セット数"
      right={
        <div className="flex items-center gap-1 text-xs">
          <button type="button" className="px-2 py-1 text-slate-400" onClick={() => setStart(addDays(start, -7))}>
            ◀
          </button>
          <span className="tabular-nums">
            {shortLabel(start)}〜{shortLabel(addDays(start, 6))}
          </span>
          <button
            type="button"
            className="px-2 py-1 text-slate-400 disabled:opacity-20"
            disabled={isThisWeek}
            onClick={() => setStart(addDays(start, 7))}
          >
            ▶
          </button>
        </div>
      }
    >
      <div className="space-y-1.5">
        {MUSCLES.map((m) => {
          const { effective, lowEffort } = vol[m];
          const color =
            effective === 0 ? 'bg-slate-700' : effective < WEEKLY_SET_MIN ? 'bg-amber-400' : effective > WEEKLY_SET_MAX ? 'bg-rose-400' : 'bg-emerald-400';
          return (
            <div key={m} className="flex items-center gap-2 text-sm">
              <span className="w-16 shrink-0 text-slate-300 text-xs">{m}</span>
              <div className="relative flex-1 h-4 rounded bg-slate-800 overflow-hidden">
                <div
                  className="absolute inset-y-0 bg-emerald-500/10 border-x border-emerald-500/40"
                  style={{ left: `${(WEEKLY_SET_MIN / max) * 100}%`, width: `${((WEEKLY_SET_MAX - WEEKLY_SET_MIN) / max) * 100}%` }}
                />
                <div className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${(effective / max) * 100}%` }} />
                <div
                  className="absolute inset-y-0 bg-slate-500/50"
                  style={{ left: `${(effective / max) * 100}%`, width: `${(lowEffort / max) * 100}%` }}
                />
              </div>
              <span className="w-12 text-right tabular-nums text-xs">
                {effective}
                {lowEffort > 0 && <span className="text-slate-500">+{lowEffort}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        補助部位は0.5セット換算。帯＝目安の週{WEEKLY_SET_MIN}〜{WEEKLY_SET_MAX}セット。灰色＝RIR4以上（集計とは区別）
      </p>
    </Card>
  );
}

function E1rmChart() {
  const { sessions, exMap } = useData();
  const ids = useMemo(() => {
    const count = {};
    for (const s of sessions) for (const x of s.sets || []) if (!x.isWarmup) count[x.exerciseId] = (count[x.exerciseId] || 0) + 1;
    return Object.keys(count)
      .filter((id) => exMap[id])
      .sort((a, b) => count[b] - count[a]);
  }, [sessions, exMap]);
  const [sel, setSel] = useState(null);
  const id = sel && ids.includes(sel) ? sel : ids[0];
  const hist = id ? exerciseHistory(sessions, id) : [];
  const series = hist.map((h) => ({ date: h.date, e1rm: Math.round(bestE1rm(h.sets) * 10) / 10, text: formatSets(h.sets) }));

  return (
    <Card title="推定1RMの推移">
      {!ids.length ? (
        <p className="text-sm text-slate-500">トレーニングを記録すると表示されます</p>
      ) : (
        <>
          <select className={`${inputCls} mb-2 text-sm`} value={id} onChange={(e) => setSel(e.target.value)}>
            {ids.map((x) => (
              <option key={x} value={x}>
                {exMap[x].name}
              </option>
            ))}
          </select>
          <div className="h-48 -ml-4">
            <ResponsiveContainer>
              <LineChart data={series}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortLabel} {...axis} minTickGap={24} />
                <YAxis domain={['dataMin - 2', 'dataMax + 2']} {...axis} width={44} tickFormatter={(v) => Math.round(v)} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v, _n, p) => [`${v}kg（${p.payload.text}）`, '推定1RM']}
                />
                <Line dataKey="e1rm" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Epley式：重量×(1+回数÷30)。値そのものより推移を見る指標</p>
        </>
      )}
    </Card>
  );
}

function Measurements() {
  const data = useData();
  const { measurements } = data;
  const keys = Object.keys(measurements).sort().reverse();
  const [form, setForm] = useState(null);
  const last = keys[0];
  return (
    <Card
      title="周囲径（2週ごと）"
      right={
        <button type="button" className="text-xs text-emerald-400" onClick={() => setForm({ date: todayKey(), ...(measurements[todayKey()] || {}) })}>
          ＋記録
        </button>
      }
    >
      {!keys.length ? (
        <p className="text-sm text-slate-500">腕・胸・ウエストの変化で、体重増が筋肉か脂肪かの目安にします</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="text-left font-normal">日付</th>
              <th className="font-normal">腕</th>
              <th className="font-normal">胸</th>
              <th className="font-normal">ウエスト</th>
            </tr>
          </thead>
          <tbody>
            {keys.slice(0, 6).map((k) => (
              <tr key={k} className="text-center" onClick={() => setForm({ date: k, ...measurements[k] })}>
                <td className="text-left py-1">{k}</td>
                <td>{measurements[k].arm ?? '—'}</td>
                <td>{measurements[k].chest ?? '—'}</td>
                <td>{measurements[k].waist ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {last && <p className="text-[11px] text-slate-500 mt-1">最終記録 {last}</p>}
      {form && (
        <Modal title="周囲径を記録" onClose={() => setForm(null)}>
          <div className="space-y-3">
            <Field label="日付">
              <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['arm', '腕 cm'],
                ['chest', '胸 cm'],
                ['waist', 'ウエスト cm'],
              ].map(([k, label]) => (
                <Field key={k} label={label}>
                  <NumberInput value={form[k] ?? null} step="0.1" onChange={(v) => setForm({ ...form, [k]: v })} />
                </Field>
              ))}
            </div>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => {
                const { date, ...m } = form;
                data.setMeasurement(date, Object.fromEntries(Object.entries(m).filter(([, v]) => v != null)));
                setForm(null);
              }}
            >
              保存
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function SessionList() {
  const data = useData();
  const { sessions, exMap } = data;
  const [open, setOpen] = useState(null);
  const [limit, setLimit] = useState(10);
  const sorted = [...sessions].sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
  const s = sessions.find((x) => x.id === open);

  return (
    <Card title="トレーニング履歴">
      {!sorted.length ? (
        <p className="text-sm text-slate-500">まだ記録がありません</p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {sorted.slice(0, limit).map((x) => {
            const work = (x.sets || []).filter((y) => !y.isWarmup).length;
            return (
              <li key={x.id}>
                <button type="button" className="w-full flex justify-between py-2 text-sm" onClick={() => setOpen(x.id)}>
                  <span>
                    {x.date} {x.dayLabel && <span className="text-emerald-400 ml-1">{x.dayLabel}</span>}
                    {x.deload && <span className="text-sky-300 ml-1 text-xs">ディロード</span>}
                  </span>
                  <span className="text-slate-400">本番{work}セット</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {sorted.length > limit && (
        <Button variant="ghost" className="w-full text-sm" onClick={() => setLimit(limit + 20)}>
          もっと見る
        </Button>
      )}
      {s && (
        <Modal title={`${s.date} ${s.dayLabel || ''}`} onClose={() => setOpen(null)}>
          <SessionDetail session={s} exMap={exMap} />
          <Button
            variant="danger"
            className="w-full mt-4"
            onClick={() => {
              if (confirm('この記録を削除しますか？')) {
                data.deleteSession(s.id);
                setOpen(null);
              }
            }}
          >
            この記録を削除
          </Button>
        </Modal>
      )}
    </Card>
  );
}

function SessionDetail({ session, exMap }) {
  const groups = [];
  for (const x of session.sets || []) {
    let g = groups.find((y) => y.exerciseId === x.exerciseId);
    if (!g) groups.push((g = { exerciseId: x.exerciseId, sets: [] }));
    g.sets.push(x);
  }
  return (
    <div className="space-y-3 text-sm">
      {groups.map((g) => (
        <div key={g.exerciseId}>
          <div className="font-bold">{exMap[g.exerciseId]?.name || g.exerciseId}</div>
          {g.sets.map((x, i) => (
            <div key={i} className={`tabular-nums ${x.isWarmup ? 'text-slate-500' : 'text-slate-300'}`}>
              {x.isWarmup ? 'W ' : ''}
              {x.weight}kg × {x.reps} @RIR{x.rir >= 4 ? '4+' : x.rir ?? '-'}
              {x.note && <span className="text-amber-300 ml-2">📝 {x.note}</span>}
            </div>
          ))}
        </div>
      ))}
      {(session.fatigue || session.sleepHours) && (
        <div className="text-xs text-slate-400">
          疲労度 {session.fatigue ?? '—'} ・ 睡眠 {session.sleepHours ?? '—'}時間
        </div>
      )}
    </div>
  );
}
