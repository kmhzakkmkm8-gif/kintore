import { describe, expect, it } from 'vitest';
import {
  e1rm,
  estimateMaintenance,
  exerciseHistory,
  formatSets,
  movingAverage,
  nextDayLabel,
  plannedMuscleLoad,
  progression,
  setsByMuscle,
  targetRir,
  trendStatus,
  weeklyExport,
} from './calc.js';
import { DEFAULT_EXERCISES, DEFAULT_PROGRAM, UPPER_LOWER_PROGRAM, defaultSettings } from './defaults.js';
import { addDays, weekStart } from './dates.js';
import { buildDraft, draftToSession, reachedTop } from './workout.js';

const exercises = DEFAULT_EXERCISES;
const exMap = Object.fromEntries(exercises.map((e) => [e.id, e]));
const set = (exerciseId, weight, reps, rir = 2, isWarmup = false) => ({ exerciseId, weight, reps, rir, isWarmup });

describe('e1rm', () => {
  it('Epley式', () => {
    expect(e1rm(40, 10)).toBeCloseTo(53.33, 2);
    expect(e1rm(0, 10)).toBe(0);
  });
});

describe('setsByMuscle', () => {
  it('補助部位は0.5、ウォームアップ除外、RIR4以上は別集計', () => {
    const v = setsByMuscle(
      [set('bench', 40, 10), set('bench', 40, 10), set('bench', 20, 10, null, true), set('bench', 30, 12, 4)],
      exMap,
    );
    expect(v['胸']).toEqual({ effective: 2, lowEffort: 1 });
    expect(v['三頭']).toEqual({ effective: 1, lowEffort: 0.5 });
  });

  it('A-B-A の週で胸9セット（仕様書の例）', () => {
    const p = DEFAULT_PROGRAM;
    const items = [...p.days[0].items, ...p.days[1].items, ...p.days[0].items];
    const sets = items.flatMap((it) => Array.from({ length: it.sets }, () => set(it.exerciseId, 20, 10)));
    const v = setsByMuscle(sets, exMap);
    expect(v['胸'].effective).toBe(9);
    expect(v['背中'].effective).toBe(9);
  });
});

describe('plannedMuscleLoad', () => {
  it('初期プログラムは1回あたり11セット以内', () => {
    for (const d of DEFAULT_PROGRAM.days) {
      for (const v of Object.values(plannedMuscleLoad(d.items, exMap))) expect(v).toBeLessThanOrEqual(11);
    }
  });
});

describe('progression', () => {
  const item = { sets: 3, repMin: 6, repMax: 10 };
  it('全セット上限達成で重量アップ', () => {
    const r = progression([set('bench', 40, 10), set('bench', 40, 10), set('bench', 40, 10)], item, exMap.bench);
    expect(r).toMatchObject({ action: 'increase', nextWeight: 42.5, reps: 6 });
  });
  it('届かなければ同重量で回数', () => {
    const r = progression([set('bench', 40, 10), set('bench', 40, 10), set('bench', 40, 9)], item, exMap.bench);
    expect(r).toMatchObject({ action: 'reps', nextWeight: 40 });
  });
  it('セット数不足なら上げない', () => {
    const r = progression([set('bench', 40, 10), set('bench', 40, 10)], item, exMap.bench);
    expect(r.action).toBe('reps');
  });
});

describe('trendStatus', () => {
  const h = (...ws) => ws.map((w, i) => ({ date: `2026-10-0${i + 1}`, sets: [set('bench', w, 8)] }));
  it('2回連続で伸びない → stall', () => {
    expect(trendStatus(h(40, 42.5, 42.5, 42.5))).toBe('stall');
  });
  it('伸びていれば ok', () => {
    expect(trendStatus(h(40, 40, 42.5))).toBe('ok');
  });
  it('3回連続低下 → decline', () => {
    expect(trendStatus(h(45, 42.5, 40, 37.5))).toBe('decline');
  });
});

describe('targetRir', () => {
  it('1〜2週目はRIR3、以降は多関節1〜2・単関節0〜1', () => {
    expect(targetRir(exMap.bench, 2).label).toBe('RIR 3');
    expect(targetRir(exMap.bench, 3).label).toBe('RIR 1〜2');
    expect(targetRir(exMap.lateral, 3).label).toBe('RIR 0〜1');
  });
});

describe('nextDayLabel', () => {
  it('A/B交互', () => {
    const p = DEFAULT_PROGRAM;
    expect(nextDayLabel([], p)).toBe('A');
    expect(nextDayLabel([{ date: '2026-10-19', programId: p.id, dayLabel: 'A' }], p)).toBe('B');
    expect(
      nextDayLabel(
        [
          { date: '2026-10-21', programId: p.id, dayLabel: 'B' },
          { date: '2026-10-23', programId: p.id, dayLabel: 'A' },
        ],
        p,
      ),
    ).toBe('B');
  });
});

describe('formatSets', () => {
  it('仕様書の書式', () => {
    expect(formatSets([set('bench', 40, 10), set('bench', 40, 10), set('bench', 40, 9)])).toBe('40kg×10,10,9 @RIR2');
    expect(formatSets([set('bench', 42.5, 8, 1), set('bench', 40, 9, 2)])).toBe('42.5kg×8 / 40kg×9 @RIR1-2');
  });
});

describe('movingAverage / estimateMaintenance', () => {
  it('7日平均は記録がある日だけで平均', () => {
    expect(movingAverage({ '2026-10-20': 50, '2026-10-18': 51 }, '2026-10-20')).toBe(50.5);
    expect(movingAverage({}, '2026-10-20')).toBeNull();
  });

  it('体重が週0.25kg増えて平均2600kcalなら維持≒2600−275', () => {
    const end = '2026-11-08';
    const bw = {};
    const nut = {};
    for (let i = 0; i < 21; i++) {
      const k = addDays(end, -20 + i);
      bw[k] = 50 + (0.25 / 7) * i;
      nut[k] = { kcal: 2600, protein: 90 };
    }
    const r = estimateMaintenance(bw, nut, end, 21);
    expect(r.ok).toBe(true);
    expect(r.weeklyGainKg).toBeCloseTo(0.25, 2);
    expect(r.maintenance).toBeGreaterThan(2300);
    expect(r.maintenance).toBeLessThan(2350);
  });

  it('記録不足なら推定しない', () => {
    expect(estimateMaintenance({}, {}, '2026-11-08').ok).toBe(false);
  });
});

describe('weeklyExport', () => {
  it('仕様書の形の週次JSONを出す', () => {
    const start = weekStart('2026-10-21');
    const sessions = [
      { id: 's1', date: '2026-10-19', dayLabel: 'A', programId: 'p', fatigue: 3, sleepHours: 6.5,
        sets: [set('bench', 20, 10, null, true), set('bench', 40, 10), set('bench', 40, 10), { ...set('bench', 40, 9), note: '右肩に違和感' }] },
      { id: 's2', date: '2026-10-23', dayLabel: 'A', programId: 'p', fatigue: 3, sleepHours: 6.5,
        sets: [set('bench', 42.5, 8, 1), set('bench', 42.5, 8, 1), set('bench', 42.5, 7, 1)] },
    ];
    const bodyweight = { '2026-10-19': 50.5, '2026-10-20': 50.7, '2026-10-13': 50.4 };
    const nutrition = { '2026-10-19': { kcal: 2600, protein: 90 }, '2026-10-20': { kcal: 2700, protein: 94 } };
    const out = weeklyExport({ sessions, exercises, bodyweight, nutrition, settings: defaultSettings('2026-10-19') }, start);
    expect(out.period).toBe('2026-10-19〜2026-10-25');
    expect(out.profile).toEqual({ heightCm: 172, weightAvg7d: 50.6, weightAvgPrev7d: 50.4 });
    expect(out.nutrition).toEqual({ kcalAvg: 2650, proteinAvg: 92, daysLogged: 2 });
    expect(out.weeklySetsByMuscle).toEqual({ 胸: 6, 三頭: 3 });
    expect(out.exercises[0]).toEqual({
      name: 'ベンチプレス',
      sessions: ['40kg×10,10,9 @RIR2', '42.5kg×8,8,7 @RIR1'],
      e1rmTrend: [53.3, 53.8],
    });
    expect(out.recovery).toEqual({ sleepAvg: 6.5, fatigueAvg: 3 });
    expect(out.notes[0]).toContain('右肩に違和感');
  });
});

describe('workout draft', () => {
  it('前回の値をプリセットし、上限達成なら重量アップ', () => {
    const sessions = [
      { id: 's1', date: '2026-10-19', programId: DEFAULT_PROGRAM.id, dayLabel: 'A',
        sets: [set('bench', 40, 10), set('bench', 40, 10), set('bench', 40, 10), set('squat', 50, 8), set('squat', 50, 8), set('squat', 50, 7)] },
    ];
    const d = buildDraft({ program: DEFAULT_PROGRAM, dayLabel: 'A', date: '2026-10-21', sessions, exMap });
    const bench = d.items.find((i) => i.exerciseId === 'bench');
    expect(bench.rows.map((r) => [r.weight, r.reps])).toEqual([[42.5, 6], [42.5, 6], [42.5, 6]]);
    const squat = d.items.find((i) => i.exerciseId === 'squat');
    expect(squat.rows.map((r) => [r.weight, r.reps])).toEqual([[50, 8], [50, 8], [50, 7]]);
    expect(bench.prevText).toBe('40kg×10,10,10 @RIR2');
  });

  it('ディロードではセット数半分', () => {
    const d = buildDraft({ program: DEFAULT_PROGRAM, dayLabel: 'A', date: '2026-10-21', sessions: [], exMap, deload: true });
    expect(d.items[0].rows).toHaveLength(2);
    expect(d.items[3].rows).toHaveLength(1);
  });

  it('完了したセットだけを1つのセッションに保存', () => {
    const d = buildDraft({ program: DEFAULT_PROGRAM, dayLabel: 'A', date: '2026-10-21', sessions: [], exMap });
    d.items[0].rows = d.items[0].rows.map((r) => ({ ...r, weight: 40, reps: 10, rir: 2, done: true }));
    d.items[0].note = 'ラック高さ5';
    d.fatigue = 2;
    expect(reachedTop(d.items[0])).toBe(true);
    const s = draftToSession(d);
    expect(s.sets).toHaveLength(3);
    expect(s.sets[2].note).toBe('ラック高さ5');
    expect(s.fatigue).toBe(2);
    expect(s).not.toHaveProperty('sleepHours');
  });
});

describe('exerciseHistory', () => {
  it('古い順・ウォームアップのみの日は除外', () => {
    const h = exerciseHistory(
      [
        { id: 'b', date: '2026-10-21', sets: [set('bench', 40, 8)] },
        { id: 'a', date: '2026-10-19', sets: [set('bench', 40, 10)] },
        { id: 'c', date: '2026-10-23', sets: [set('bench', 20, 10, null, true)] },
      ],
      'bench',
    );
    expect(h.map((x) => x.sessionId)).toEqual(['a', 'b']);
  });
});

describe('上半身／下半身プログラム', () => {
  const p = UPPER_LOWER_PROGRAM;
  const weekly = (sessionsPerWeek) => {
    const out = {};
    for (const d of p.days)
      for (const [m, v] of Object.entries(plannedMuscleLoad(d.items, exMap)))
        out[m] = (out[m] || 0) + (v * sessionsPerWeek) / p.days.length;
    return out;
  };
  it('全種目が種目マスタにあり、1回あたり11セット以内', () => {
    for (const d of p.days) {
      for (const it of d.items) expect(exMap[it.exerciseId]).toBeTruthy();
      for (const v of Object.values(plannedMuscleLoad(d.items, exMap))) expect(v).toBeLessThanOrEqual(11);
    }
  });
  it('週4回で主要部位が週9セット以上、週5回でも20セット以下', () => {
    const w4 = weekly(4);
    for (const m of ['胸', '背中', '脚前', '脚裏']) expect(w4[m]).toBeGreaterThanOrEqual(9);
    for (const v of Object.values(weekly(5))) expect(v).toBeLessThanOrEqual(20);
  });
  it('順番に回る（週の回数に関係なく 上A→下A→上B→下B）', () => {
    const s = (date, dayLabel) => ({ date, dayLabel, programId: p.id });
    expect(nextDayLabel([s('2026-10-19', '上A'), s('2026-10-20', '下A'), s('2026-10-22', '上B')], p)).toBe('下B');
    expect(nextDayLabel([s('2026-10-19', '下B')], p)).toBe('上A');
  });
});
