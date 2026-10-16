import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { COLLECTIONS, createBackend, newId } from './backend.js';
import { DEFAULT_EXERCISES, DEFAULT_FOODS, DEFAULT_PROGRAM, defaultSettings } from './defaults.js';
import { todayKey } from './dates.js';

const DataContext = createContext(null);

const toMap = (docs, field) => Object.fromEntries(docs.map((d) => [d.id, field ? d[field] : d]));

export function DataProvider({ uid, children }) {
  const backend = useMemo(() => createBackend(uid), [uid]);
  const [raw, setRaw] = useState({});
  const [fromServer, setFromServer] = useState({});
  const seeded = useRef(false);

  useEffect(() => {
    const unsubs = COLLECTIONS.map((name) =>
      backend.subscribe(name, (docs, meta) => {
        setRaw((r) => ({ ...r, [name]: docs }));
        if (!meta.fromCache) setFromServer((f) => (f[name] ? f : { ...f, [name]: true }));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [backend]);

  const loaded = COLLECTIONS.every((c) => raw[c]);

  // 初回: 設定がサーバー上にも存在しなければ初期データを投入（id固定なので重複しない）
  useEffect(() => {
    if (seeded.current || !fromServer.settings || !raw.settings) return;
    seeded.current = true;
    if (raw.settings.some((d) => d.id === 'profile')) return;
    const today = todayKey();
    const { id: pid, ...program } = DEFAULT_PROGRAM;
    backend.setMany([
      ...DEFAULT_EXERCISES.map(({ id, ...e }) => ['exercises', id, e]),
      ['programs', pid, program],
      ...DEFAULT_FOODS.map(({ id, ...f }) => ['foods', id, f]),
      ['settings', 'profile', defaultSettings(today)],
    ]);
  }, [fromServer.settings, raw.settings, backend]);

  const value = useMemo(() => {
    const exercises = (raw.exercises || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const programs = raw.programs || [];
    const settingsDoc = (raw.settings || []).find((d) => d.id === 'profile');
    const settings = { ...defaultSettings(todayKey()), ...(settingsDoc || {}) };
    const data = {
      ready: loaded && Boolean(settingsDoc),
      backendKind: backend.kind,
      exercises,
      exMap: toMap(exercises),
      programs,
      activeProgram: programs.find((p) => p.active) || programs[0] || null,
      sessions: raw.sessions || [],
      bodyweight: toMap(raw.bodyweight || [], 'kg'),
      nutrition: toMap(raw.nutrition || []),
      foods: (raw.foods || []).slice().sort((a, b) => (b.uses || 0) - (a.uses || 0)),
      measurements: toMap(raw.measurements || []),
      settings,
    };

    const actions = {
      saveExercise(ex) {
        const { id = newId(), ...rest } = ex;
        backend.set('exercises', id, rest);
        return id;
      },
      deleteExercise: (id) => backend.remove('exercises', id),
      saveProgram(p) {
        const { id = newId(), ...rest } = p;
        backend.set('programs', id, rest);
        return id;
      },
      activateProgram(id) {
        for (const p of programs) {
          const { id: pid, ...rest } = p;
          if (Boolean(rest.active) !== (pid === id)) backend.set('programs', pid, { ...rest, active: pid === id });
        }
      },
      deleteProgram: (id) => backend.remove('programs', id),
      saveSession(s) {
        const { id = newId(), ...rest } = s;
        backend.set('sessions', id, { createdAt: Date.now(), ...rest });
        return id;
      },
      deleteSession: (id) => backend.remove('sessions', id),
      setBodyweight(date, kg) {
        if (kg == null || kg === '' || Number.isNaN(kg)) backend.remove('bodyweight', date);
        else backend.set('bodyweight', date, { kg: Number(kg) });
      },
      setNutrition(date, docData) {
        const { id: _drop, ...rest } = docData;
        backend.set('nutrition', date, rest);
      },
      saveFood(f) {
        const { id = newId(), ...rest } = f;
        backend.set('foods', id, rest);
        return id;
      },
      deleteFood: (id) => backend.remove('foods', id),
      setMeasurement(date, m) {
        backend.set('measurements', date, m);
      },
      saveSettings(patch) {
        const { id: _drop, ...cur } = settings;
        backend.set('settings', 'profile', { ...cur, ...patch });
      },
      exportAll() {
        const out = { version: 1, exportedAt: new Date().toISOString() };
        for (const c of COLLECTIONS) out[c] = raw[c] || [];
        return out;
      },
      async importAll(json) {
        const entries = [];
        for (const c of COLLECTIONS) {
          for (const d of json[c] || []) {
            const { id, ...rest } = d;
            if (id) entries.push([c, id, rest]);
          }
        }
        await backend.setMany(entries);
        return entries.length;
      },
    };
    return { ...data, ...actions };
  }, [raw, loaded, backend]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}
