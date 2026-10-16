import { MUSCLES } from './defaults.js';
import { addDays, diffDays, rangeKeys, weekStart } from './dates.js';

const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

// ---- トレーニング ----

// Epley式。値そのものより同じ種目での推移を見るための指標
export function e1rm(weight, reps) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

export function workingSets(sets) {
  return (sets || []).filter((s) => !s.isWarmup);
}

// RIR 4以上は「余力が大きすぎる」セットとして別集計
export function isEffective(set) {
  return set.rir == null || set.rir <= 3;
}

export function bestE1rm(sets) {
  return workingSets(sets).reduce((m, s) => Math.max(m, e1rm(s.weight, s.reps)), 0);
}

// 部位ごとのセット数（主部位=1、補助部位=0.5 の fractional 方式）
// 戻り値: { 胸: { effective, lowEffort }, ... }
export function setsByMuscle(sets, exMap) {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, { effective: 0, lowEffort: 0 }]));
  for (const s of workingSets(sets)) {
    const ex = exMap[s.exerciseId];
    if (!ex) continue;
    const key = isEffective(s) ? 'effective' : 'lowEffort';
    for (const m of ex.primary || []) if (out[m]) out[m][key] += 1;
    for (const m of ex.secondary || []) if (out[m]) out[m][key] += 0.5;
  }
  return out;
}

export function sessionsInRange(sessions, start, end) {
  return sessions.filter((s) => s.date >= start && s.date <= end);
}

export function weeklySetsByMuscle(sessions, exMap, start) {
  const end = addDays(start, 6);
  return setsByMuscle(
    sessionsInRange(sessions, start, end).flatMap((s) => s.sets || []),
    exMap,
  );
}

// 計画（種目×セット数）から1回あたりの部位別セット数を出す（11セット超の警告用）
export function plannedMuscleLoad(items, exMap) {
  const out = {};
  for (const it of items) {
    const ex = exMap[it.exerciseId];
    if (!ex) continue;
    for (const m of ex.primary || []) out[m] = (out[m] || 0) + it.sets;
    for (const m of ex.secondary || []) out[m] = (out[m] || 0) + it.sets * 0.5;
  }
  return out;
}

// 種目の履歴（古い順）: [{ date, sessionId, sets }]
export function exerciseHistory(sessions, exerciseId) {
  return [...sessions]
    .sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1))
    .map((s) => ({
      date: s.date,
      sessionId: s.id,
      sets: (s.sets || []).filter((x) => x.exerciseId === exerciseId),
    }))
    .filter((h) => workingSets(h.sets).length > 0);
}

// プログラム開始からの週番号（1始まり）
export function programWeek(startDate, today) {
  if (!startDate) return 1;
  return Math.max(1, Math.floor(diffDays(startDate, today) / 7) + 1);
}

// 強度の段階: 1〜2週目は全セットRIR3、以降は多関節1〜2・単関節0〜1
export function targetRir(exercise, week) {
  if (week <= 2) return { min: 3, max: 3, label: 'RIR 3' };
  if (exercise?.compound) return { min: 1, max: 2, label: 'RIR 1〜2' };
  return { min: 0, max: 1, label: 'RIR 0〜1' };
}

// ダブルプログレッション
// 前回の本番セットが計画セット数ぶん、すべてレップ域の上限に届いていれば重量アップ
export function progression(prevSets, item, exercise) {
  const ws = workingSets(prevSets);
  if (!ws.length) return { action: 'none' };
  const topWeight = Math.max(...ws.map((s) => s.weight));
  const top = ws.filter((s) => s.weight === topWeight);
  const inc = exercise?.increment || 2.5;
  if (top.length >= (item?.sets || 1) && top.every((s) => s.reps >= item.repMax)) {
    return { action: 'increase', weight: topWeight, nextWeight: round1(topWeight + inc), reps: item.repMin };
  }
  return { action: 'reps', weight: topWeight, nextWeight: topWeight };
}

// 停滞・低下の判定（推定1RMのセッション最大値で比較）
// stall: 2回連続で伸びていない（経験則: 部位の週セット数を+1〜2）
// decline: 3回連続で下がった（経験則: 1週間ディロード）
export function trendStatus(history) {
  const v = history.map((h) => bestE1rm(h.sets));
  const n = v.length;
  const eps = 0.05;
  if (n >= 4 && v[n - 1] < v[n - 2] - eps && v[n - 2] < v[n - 3] - eps && v[n - 3] < v[n - 4] - eps) {
    return 'decline';
  }
  if (n >= 3 && v[n - 1] <= v[n - 2] + eps && v[n - 2] <= v[n - 3] + eps) return 'stall';
  return 'ok';
}

// 次にやる日（A→B→A→B…と交互）
export function nextDayLabel(sessions, program) {
  const labels = (program?.days || []).map((d) => d.label);
  if (!labels.length) return null;
  const last = [...sessions]
    .filter((s) => s.programId === program.id && labels.includes(s.dayLabel))
    .sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1))
    .pop();
  if (!last) return labels[0];
  return labels[(labels.indexOf(last.dayLabel) + 1) % labels.length];
}

// "40kg×10,10,9 @RIR2" 形式
export function formatSets(sets) {
  const ws = workingSets(sets);
  if (!ws.length) return '';
  const groups = [];
  for (const s of ws) {
    const g = groups[groups.length - 1];
    if (g && g.weight === s.weight) g.reps.push(s.reps);
    else groups.push({ weight: s.weight, reps: [s.reps] });
  }
  const rirs = ws.map((s) => s.rir).filter((r) => r != null);
  const lo = Math.min(...rirs);
  const hi = Math.max(...rirs);
  const rirText = !rirs.length ? '' : lo === hi ? ` @RIR${fmtRir(lo)}` : ` @RIR${lo}-${fmtRir(hi)}`;
  return groups.map((g) => `${g.weight}kg×${g.reps.join(',')}`).join(' / ') + rirText;
}

const fmtRir = (r) => (r >= 4 ? '4+' : String(r));

// ---- 体重・栄養 ----

// bwMap: { 'YYYY-MM-DD': kg }。key を含む直近7日の平均（記録がある日のみ）
export function movingAverage(bwMap, key, days = 7) {
  const vals = [];
  for (let i = 0; i < days; i++) {
    const v = bwMap[addDays(key, -i)];
    if (v != null) vals.push(v);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function weightSeries(bwMap, start, end) {
  return rangeKeys(start, end).map((date) => {
    const ma = movingAverage(bwMap, date);
    return { date, kg: bwMap[date] ?? null, ma7: ma == null ? null : round2(ma) };
  });
}

export function proteinTarget(settings, weightKg) {
  return Math.round((settings.targetProteinPerKg || 1.6) * (weightKg || 50));
}

export function nutritionTotals(doc) {
  if (!doc) return { kcal: 0, protein: 0 };
  return { kcal: Math.round(doc.kcal || 0), protein: Math.round(doc.protein || 0) };
}

// 体重の推移と平均摂取kcalから維持カロリーを推定する
// 維持 ≒ 平均摂取 − (7日平均体重の変化kg × 7700) ÷ 日数
export function estimateMaintenance(bwMap, nutritionMap, endKey, days = 21) {
  const startKey = addDays(endKey, -(days - 1));
  const logged = rangeKeys(startKey, endKey)
    .map((k) => nutritionMap[k]?.kcal)
    .filter((v) => v > 0);
  const maStart = movingAverage(bwMap, addDays(startKey, 6));
  const maEnd = movingAverage(bwMap, endKey);
  if (logged.length < Math.ceil(days * 0.7) || maStart == null || maEnd == null) {
    return { ok: false, daysLogged: logged.length, needed: Math.ceil(days * 0.7) };
  }
  const span = days - 7; // 移動平均の中心どうしの間隔
  const avgKcal = logged.reduce((a, b) => a + b, 0) / logged.length;
  const deltaKg = maEnd - maStart;
  const maintenance = avgKcal - (deltaKg * 7700) / span;
  return {
    ok: true,
    avgKcal: Math.round(avgKcal),
    weeklyGainKg: round2((deltaKg / span) * 7),
    maintenance: Math.round(maintenance / 10) * 10,
    daysLogged: logged.length,
  };
}

export function suggestedKcal(maintenance, gainPerWeekKg) {
  return Math.round((maintenance + (gainPerWeekKg * 7700) / 7) / 50) * 50;
}

// ---- 書き出し ----

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

export function weeklyExport({ sessions, exercises, bodyweight, nutrition, settings }, anyDayInWeek) {
  const start = weekStart(anyDayInWeek);
  const end = addDays(start, 6);
  const exMap = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const days = rangeKeys(start, end);
  const prevDays = rangeKeys(addDays(start, -7), addDays(start, -1));
  const bwAvg = (keys) => {
    const v = avg(keys.map((k) => bodyweight[k]).filter((x) => x != null));
    return v == null ? null : round1(v);
  };

  const nDays = days.map((k) => nutrition[k]).filter((n) => n && n.kcal > 0);
  const weekSessions = sessionsInRange(sessions, start, end).sort((a, b) => (a.date < b.date ? -1 : 1));

  const byMuscle = weeklySetsByMuscle(sessions, exMap, start);
  const weeklySets = {};
  const lowEffort = {};
  for (const [m, v] of Object.entries(byMuscle)) {
    if (v.effective) weeklySets[m] = v.effective;
    if (v.lowEffort) lowEffort[m] = v.lowEffort;
  }

  const exIds = [];
  for (const s of weekSessions) for (const x of workingSets(s.sets)) if (!exIds.includes(x.exerciseId)) exIds.push(x.exerciseId);
  const exerciseSummaries = exIds.map((id) => {
    const hist = weekSessions
      .map((s) => (s.sets || []).filter((x) => x.exerciseId === id))
      .filter((ss) => workingSets(ss).length);
    return {
      name: exMap[id]?.name || id,
      sessions: hist.map(formatSets),
      e1rmTrend: hist.map((ss) => round1(bestE1rm(ss))),
    };
  });

  const notes = [];
  for (const s of weekSessions) {
    for (const x of s.sets || []) {
      if (x.note) notes.push(`${s.date} ${exMap[x.exerciseId]?.name || x.exerciseId}: ${x.note}`);
    }
    if (s.note) notes.push(`${s.date}: ${s.note}`);
  }
  for (const k of days) if (nutrition[k]?.memo) notes.push(`${k} 食事: ${nutrition[k].memo}`);

  const sleep = weekSessions.map((s) => s.sleepHours).filter((v) => v != null && v !== '');
  const fatigue = weekSessions.map((s) => s.fatigue).filter((v) => v != null && v !== '');
  const r = (v) => (v == null ? null : round1(v));

  const out = {
    period: `${start}〜${end}`,
    programWeek: programWeek(settings.programStartDate, start),
    profile: {
      heightCm: settings.heightCm,
      weightAvg7d: bwAvg(days),
      weightAvgPrev7d: bwAvg(prevDays),
    },
    targets: {
      kcal: settings.targetKcal,
      proteinG: proteinTarget(settings, bwAvg(days) ?? bwAvg(prevDays)),
      gainPerWeekKg: settings.targetGainPerWeekKg,
    },
    nutrition: {
      kcalAvg: nDays.length ? Math.round(avg(nDays.map((n) => n.kcal))) : null,
      proteinAvg: nDays.length ? Math.round(avg(nDays.map((n) => n.protein || 0))) : null,
      daysLogged: nDays.length,
    },
    weeklySetsByMuscle: weeklySets,
    exercises: exerciseSummaries,
    recovery: { sleepAvg: r(avg(sleep.map(Number))), fatigueAvg: r(avg(fatigue.map(Number))) },
    notes,
  };
  if (Object.keys(lowEffort).length) out.lowEffortSetsByMuscle = lowEffort; // RIR4以上
  return out;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function setsCSV(sessions, exercises) {
  const exMap = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const rows = [['date', 'day', 'exercise', 'set', 'weight_kg', 'reps', 'rir', 'warmup', 'e1rm', 'note']];
  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const s of sorted) {
    const counter = {};
    for (const x of s.sets || []) {
      counter[x.exerciseId] = (counter[x.exerciseId] || 0) + 1;
      rows.push([
        s.date, s.dayLabel || '', exMap[x.exerciseId]?.name || x.exerciseId, counter[x.exerciseId],
        x.weight, x.reps, x.rir, x.isWarmup ? 1 : 0, x.isWarmup ? '' : round1(e1rm(x.weight, x.reps)), x.note || '',
      ]);
    }
  }
  return toCSV(rows);
}

export function dailyCSV(bodyweight, nutrition) {
  const keys = [...new Set([...Object.keys(bodyweight), ...Object.keys(nutrition)])].sort();
  const rows = [['date', 'weight_kg', 'weight_ma7', 'kcal', 'protein_g']];
  for (const k of keys) {
    const ma = movingAverage(bodyweight, k);
    rows.push([k, bodyweight[k] ?? '', ma == null ? '' : round2(ma), nutrition[k]?.kcal ?? '', nutrition[k]?.protein ?? '']);
  }
  return toCSV(rows);
}
