// トレーニング実施中の下書き（端末内に保存し、完了時に1回の書き込みでセッションを保存する）
import { exerciseHistory, formatSets, progression, trendStatus, workingSets } from './calc.js';

const DRAFT_KEY = 'kintore:draft';

export function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveDraft(draft) {
  if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  else localStorage.removeItem(DRAFT_KEY);
}

// 1種目ぶんの下書きを作る。前回の重量×回数をプリセットし、上限達成なら重量アップした値を入れる
export function buildItem({ exerciseId, sets, repMin, repMax }, { sessions, exMap, deload }) {
  const ex = exMap[exerciseId];
  const hist = exerciseHistory(sessions, exerciseId);
  const last = hist[hist.length - 1];
  const prev = last ? workingSets(last.sets) : [];
  const plan = { exerciseId, sets, repMin, repMax };
  const prog = progression(prev, plan, ex);
  const n = deload ? Math.max(1, Math.ceil(sets / 2)) : sets;
  const rows = Array.from({ length: n }, (_, i) => {
    const p = prev[i] || prev[prev.length - 1];
    const increase = prog.action === 'increase';
    return {
      weight: increase ? prog.nextWeight : p?.weight ?? 0,
      reps: increase ? repMin : p?.reps ?? repMin,
      rir: null,
      isWarmup: false,
      done: false,
    };
  });
  return {
    exerciseId,
    planSets: n,
    repMin,
    repMax,
    rows,
    note: '',
    prevText: last ? formatSets(last.sets) : '',
    prevDate: last?.date || null,
    progression: prog,
    trend: trendStatus(hist),
  };
}

export function buildDraft({ program, dayLabel, date, sessions, exMap, deload }) {
  const day = program?.days.find((d) => d.label === dayLabel);
  return {
    date,
    programId: program?.id || null,
    dayLabel: dayLabel || null,
    deload: Boolean(deload),
    startedAt: Date.now(),
    restEndAt: null,
    fatigue: null,
    sleepHours: null,
    items: (day?.items || []).filter((it) => exMap[it.exerciseId]).map((it) => buildItem(it, { sessions, exMap, deload })),
  };
}

// 今回のセットで上限に届いたか（全計画セットが完了し、すべて repMax 以上）
export function reachedTop(item) {
  const done = item.rows.filter((r) => r.done && !r.isWarmup);
  return done.length >= item.planSets && done.every((r) => r.reps >= item.repMax);
}

export function draftToSession(draft) {
  const sets = [];
  for (const it of draft.items) {
    const done = it.rows.filter((r) => r.done);
    done.forEach((r, i) => {
      const s = {
        exerciseId: it.exerciseId,
        weight: Number(r.weight) || 0,
        reps: Number(r.reps) || 0,
        rir: r.rir,
        isWarmup: Boolean(r.isWarmup),
      };
      if (i === done.length - 1 && it.note.trim()) s.note = it.note.trim();
      sets.push(s);
    });
  }
  const session = { date: draft.date, programId: draft.programId, dayLabel: draft.dayLabel, sets };
  if (draft.fatigue != null) session.fatigue = draft.fatigue;
  if (draft.sleepHours != null) session.sleepHours = draft.sleepHours;
  if (draft.deload) session.deload = true;
  return session;
}
