import { useRef, useState } from 'react';
import { useData } from '../lib/store.jsx';
import { isFirebaseConfigured, logout } from '../lib/backend.js';
import { addDays, shortLabel, todayKey, weekStart } from '../lib/dates.js';
import { dailyCSV, plannedMuscleLoad, setsCSV, weeklyExport } from '../lib/calc.js';
import { MUSCLES, REVIEW_PROMPT, SESSION_SET_CAP } from '../lib/defaults.js';
import { Button, Card, Chip, Field, Modal, NumberInput, copyText, download, inputCls, useToast } from '../components/ui.jsx';
import { ExercisePicker } from './Workout.jsx';

export default function Settings() {
  const [toast, showToast] = useToast();
  return (
    <div className="space-y-3 pt-2">
      <h1 className="text-xl font-bold">設定・データ</h1>
      <WeeklyExport showToast={showToast} />
      <Targets showToast={showToast} />
      <ProgramEditor showToast={showToast} />
      <ExerciseMaster />
      <DataTools showToast={showToast} />
      <Account />
      {toast}
    </div>
  );
}

function WeeklyExport({ showToast }) {
  const data = useData();
  // 日曜夜に書き出す想定。既定は今週
  const [start, setStart] = useState(weekStart(todayKey()));
  const [preview, setPreview] = useState(false);
  const json = JSON.stringify(weeklyExport(data, start), null, 2);
  return (
    <Card title="週次レビュー用JSON" right={<span className="text-[11px] text-slate-500">Claudeに貼り付け</span>}>
      <div className="flex items-center justify-between mb-3 text-sm">
        <button type="button" className="px-3 py-1 text-slate-400" onClick={() => setStart(addDays(start, -7))}>
          ◀
        </button>
        <span className="tabular-nums">
          {shortLabel(start)}（月）〜{shortLabel(addDays(start, 6))}（日）
        </span>
        <button
          type="button"
          className="px-3 py-1 text-slate-400 disabled:opacity-20"
          disabled={start >= weekStart(todayKey())}
          onClick={() => setStart(addDays(start, 7))}
        >
          ▶
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={async () => showToast((await copyText(json)) ? 'コピーしました' : 'コピーできませんでした')}>
          JSONをコピー
        </Button>
        <Button onClick={() => download(`kintore-week-${start}.json`, json)}>ダウンロード</Button>
        <Button onClick={() => setPreview((v) => !v)}>{preview ? '閉じる' : '中身を見る'}</Button>
        <Button onClick={async () => showToast((await copyText(REVIEW_PROMPT)) ? 'プロンプトをコピーしました' : 'コピーできませんでした')}>
          レビュー用プロンプト
        </Button>
      </div>
      {preview && <pre className="mt-3 text-[11px] bg-slate-950 rounded-xl p-3 overflow-x-auto max-h-80">{json}</pre>}
    </Card>
  );
}

function Targets({ showToast }) {
  const { settings, saveSettings } = useData();
  const [f, setF] = useState(settings);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const fields = [
    ['heightCm', '身長 cm', '1'],
    ['targetKcal', '目標 kcal/日', '50', '維持＋150〜400kcalから開始し、体重推移で調整'],
    ['targetProteinPerKg', 'タンパク質 g/kg', '0.1', '1.6g/kg以上（〜2.2まで）'],
    ['targetGainPerWeekKg', '増量ペース kg/週', '0.01', '週0.13〜0.25kg'],
    ['restSeconds', '休息タイマー 秒', '10', '90〜120秒'],
  ];
  return (
    <Card title="目標値">
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([k, label, step, hint]) => (
          <Field key={k} label={label} hint={hint}>
            <NumberInput value={f[k]} step={step} onChange={set(k)} />
          </Field>
        ))}
        <Field label="プログラム開始日" hint="1〜2週目はRIR3、以降は強度を上げる">
          <input type="date" className={inputCls} value={f.programStartDate || ''} onChange={(e) => set('programStartDate')(e.target.value)} />
        </Field>
      </div>
      <Button
        variant="primary"
        className="w-full mt-3"
        onClick={() => {
          const { id: _drop, ...rest } = f;
          saveSettings(rest);
          showToast('保存しました');
        }}
      >
        保存
      </Button>
    </Card>
  );
}

function ProgramEditor({ showToast }) {
  const data = useData();
  const { activeProgram, exMap } = data;
  const [p, setP] = useState(activeProgram);
  const [picker, setPicker] = useState(null); // { day, index | null }
  if (!p) return null;
  const dirty = JSON.stringify(p) !== JSON.stringify(activeProgram);

  const updDay = (di, fn) => setP({ ...p, days: p.days.map((d, j) => (j === di ? fn(d) : d)) });
  const updItem = (di, ii, patch) => updDay(di, (d) => ({ ...d, items: d.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) }));

  // 週あたりの部位別セット数の見込み（A-B-A / B-A-B の2週平均 = 各日1.5回/週）
  const perWeek = {};
  const freq = p.days.length ? 3 / p.days.length : 0;
  for (const d of p.days) {
    for (const [m, v] of Object.entries(plannedMuscleLoad(d.items, exMap))) perWeek[m] = (perWeek[m] || 0) + v * freq;
  }

  return (
    <Card title="プログラム" right={<span className="text-xs text-slate-400">{p.name}</span>}>
      <div className="space-y-4">
        {p.days.map((d, di) => {
          const load = plannedMuscleLoad(d.items, exMap);
          const over = Object.entries(load).filter(([, v]) => v > SESSION_SET_CAP);
          return (
            <div key={di}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-bold text-emerald-400">{d.label}の日</h3>
                {p.days.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-slate-500"
                    onClick={() => confirm(`${d.label}の日を削除しますか？`) && setP({ ...p, days: p.days.filter((_, j) => j !== di) })}
                  >
                    日を削除
                  </button>
                )}
              </div>
              <ul className="space-y-2">
                {d.items.map((it, ii) => (
                  <li key={ii} className="rounded-xl bg-slate-800/60 p-2">
                    <div className="flex items-center gap-2">
                      <button type="button" className="flex-1 text-left text-sm truncate" onClick={() => setPicker({ day: di, index: ii })}>
                        {exMap[it.exerciseId]?.name || '（削除された種目）'} <span className="text-slate-500 text-xs">変更</span>
                      </button>
                      <button type="button" className="text-slate-400 px-1" onClick={() => ii > 0 && updDay(di, (dd) => swap(dd, ii, ii - 1))}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className="text-slate-400 px-1"
                        onClick={() => ii < d.items.length - 1 && updDay(di, (dd) => swap(dd, ii, ii + 1))}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="text-slate-500 px-1"
                        onClick={() => updDay(di, (dd) => ({ ...dd, items: dd.items.filter((_, j) => j !== ii) }))}
                      >
                        ×
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {[
                        ['sets', 'セット'],
                        ['repMin', '回数 下限'],
                        ['repMax', '回数 上限'],
                      ].map(([k, label]) => (
                        <Field key={k} label={label}>
                          <NumberInput value={it[k]} step="1" className="py-1.5 text-sm" onChange={(v) => updItem(di, ii, { [k]: v ?? 0 })} />
                        </Field>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              {over.length > 0 && (
                <p className="text-xs text-amber-300 mt-1">⚠ 1回で11セット超：{over.map(([m, v]) => `${m} ${v}`).join('、')}</p>
              )}
              <Button className="w-full mt-2 text-sm py-2" onClick={() => setPicker({ day: di, index: null })}>
                ＋ 種目
              </Button>
            </div>
          );
        })}
        <Button
          className="w-full text-sm"
          onClick={() => {
            const label = String.fromCharCode(65 + p.days.length);
            setP({ ...p, days: [...p.days, { label, items: [] }] });
          }}
        >
          ＋ {String.fromCharCode(65 + p.days.length)}の日を追加
        </Button>

        <div>
          <div className="text-xs text-slate-400 mb-1">週3回で回した場合の部位別 週セット数（0.5換算）</div>
          <div className="flex flex-wrap gap-1.5">
            {MUSCLES.map((m) => {
              const v = Math.round((perWeek[m] || 0) * 2) / 2;
              return (
                <span
                  key={m}
                  className={`text-xs rounded-full px-2 py-0.5 ${
                    v === 0 ? 'bg-slate-800 text-slate-500' : v < 10 ? 'bg-amber-500/20 text-amber-200' : v > 20 ? 'bg-rose-500/20 text-rose-200' : 'bg-emerald-500/20 text-emerald-200'
                  }`}
                >
                  {m} {v}
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <Button className="flex-1" disabled={!dirty} onClick={() => setP(activeProgram)}>
            元に戻す
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={!dirty}
            onClick={() => {
              data.saveProgram(p);
              showToast('プログラムを保存しました');
            }}
          >
            保存
          </Button>
        </div>
      </div>
      {picker && (
        <ExercisePicker
          base={picker.index != null ? exMap[p.days[picker.day].items[picker.index].exerciseId] : null}
          onClose={() => setPicker(null)}
          onPick={(exerciseId) => {
            if (picker.index != null) updItem(picker.day, picker.index, { exerciseId });
            else
              updDay(picker.day, (d) => ({
                ...d,
                items: [...d.items, { exerciseId, sets: 2, repMin: 8, repMax: 12 }],
              }));
            setPicker(null);
          }}
        />
      )}
    </Card>
  );
}

function swap(day, a, b) {
  const items = [...day.items];
  [items[a], items[b]] = [items[b], items[a]];
  return { ...day, items };
}

function ExerciseMaster() {
  const { exercises, saveExercise, deleteExercise } = useData();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  return (
    <Card
      title="種目マスタ"
      right={
        <button type="button" className="text-xs text-emerald-400" onClick={() => setOpen((v) => !v)}>
          {open ? '閉じる' : `${exercises.length}種目を表示`}
        </button>
      }
    >
      {open && (
        <>
          <ul className="divide-y divide-slate-800">
            {exercises.map((e) => (
              <li key={e.id}>
                <button type="button" className="w-full text-left py-2" onClick={() => setEdit(e)}>
                  <div className="text-sm">
                    {e.name}
                    {e.stretchFocus && <span className="ml-1 text-[10px] text-sky-300">伸張位</span>}
                    {e.compound && <span className="ml-1 text-[10px] text-slate-400">多関節</span>}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {(e.primary || []).join('・')}
                    {e.secondary?.length ? ` ／ 補助 ${e.secondary.join('・')}` : ''} ・ +{e.increment}kg刻み
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <Button
            className="w-full mt-2"
            onClick={() => setEdit({ name: '', primary: [], secondary: [], stretchFocus: false, compound: false, increment: 2.5 })}
          >
            ＋ 種目を追加
          </Button>
        </>
      )}
      {edit && (
        <ExerciseEditor
          ex={edit}
          onClose={() => setEdit(null)}
          onSave={(e) => {
            saveExercise(e);
            setEdit(null);
          }}
          onDelete={
            edit.id
              ? () => {
                  if (confirm('削除しますか？（過去の記録では名前が表示されなくなります）')) {
                    deleteExercise(edit.id);
                    setEdit(null);
                  }
                }
              : null
          }
        />
      )}
    </Card>
  );
}

function ExerciseEditor({ ex, onSave, onClose, onDelete }) {
  const [e, setE] = useState(ex);
  const toggle = (key, m) => {
    const other = key === 'primary' ? 'secondary' : 'primary';
    const has = e[key].includes(m);
    setE({ ...e, [key]: has ? e[key].filter((x) => x !== m) : [...e[key], m], [other]: e[other].filter((x) => x !== m) });
  };
  return (
    <Modal title={ex.id ? '種目を編集' : '種目を追加'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="名前">
          <input className={inputCls} value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} />
        </Field>
        {[
          ['primary', '主部位（1セット）'],
          ['secondary', '補助部位（0.5セット）'],
        ].map(([key, label]) => (
          <div key={key}>
            <div className="text-xs text-slate-400 mb-1">{label}</div>
            <div className="flex flex-wrap gap-1.5">
              {MUSCLES.map((m) => (
                <Chip key={m} active={e[key].includes(m)} onClick={() => toggle(key, m)}>
                  {m}
                </Chip>
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={e.stretchFocus} onChange={(x) => setE({ ...e, stretchFocus: x.target.checked })} />
            伸張位で効く
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={e.compound} onChange={(x) => setE({ ...e, compound: x.target.checked })} />
            多関節種目
          </label>
        </div>
        <Field label="重量アップの刻み kg" hint="上半身+1〜2.5kg、下半身+2.5〜5kg、またはジムの最小刻み">
          <NumberInput value={e.increment} step="0.25" onChange={(v) => setE({ ...e, increment: v })} />
        </Field>
        <div className="flex gap-2">
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              削除
            </Button>
          )}
          <Button
            variant="primary"
            className="flex-1"
            disabled={!e.name || !e.primary.length}
            onClick={() => onSave({ ...e, increment: e.increment || 2.5 })}
          >
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DataTools({ showToast }) {
  const data = useData();
  const fileRef = useRef(null);
  const [confirmImport, setConfirmImport] = useState(null);
  const today = todayKey();
  return (
    <Card title="書き出し・バックアップ">
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => download(`kintore-sets-${today}.csv`, '﻿' + setsCSV(data.sessions, data.exercises), 'text/csv')}>
          セットCSV
        </Button>
        <Button onClick={() => download(`kintore-daily-${today}.csv`, '﻿' + dailyCSV(data.bodyweight, data.nutrition), 'text/csv')}>
          体重・食事CSV
        </Button>
        <Button onClick={() => download(`kintore-backup-${today}.json`, JSON.stringify(data.exportAll(), null, 2))}>
          全データJSON
        </Button>
        <Button onClick={() => fileRef.current?.click()}>JSONから復元</Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const json = JSON.parse(await file.text());
            if (!json.version) throw new Error('バックアップ形式ではありません');
            setConfirmImport(json);
          } catch (err) {
            showToast(err.message);
          }
        }}
      />
      {confirmImport && (
        <Modal title="バックアップを復元" onClose={() => setConfirmImport(null)}>
          <p className="text-sm text-slate-400 mb-4">同じIDの記録は上書きされます（それ以外の記録は残ります）。</p>
          <Button
            variant="primary"
            className="w-full"
            onClick={async () => {
              const n = await data.importAll(confirmImport);
              setConfirmImport(null);
              showToast(`${n}件を復元しました`);
            }}
          >
            復元する
          </Button>
        </Modal>
      )}
    </Card>
  );
}

function Account() {
  const { backendKind } = useData();
  return (
    <Card title="保存先">
      {isFirebaseConfigured ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-300">Firebase（オフライン対応・自動同期）</span>
          <Button className="text-xs py-1.5" onClick={() => logout()}>
            ログアウト
          </Button>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          ローカルモード（{backendKind}）：この端末のブラウザにだけ保存されています。機種変更に備えて定期的に「全データJSON」を書き出すか、
          <code className="text-xs">.env.local</code> にFirebaseの設定を入れてクラウド同期を有効にしてください。
        </p>
      )}
    </Card>
  );
}
