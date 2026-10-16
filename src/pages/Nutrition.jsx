import { useState } from 'react';
import { useData } from '../lib/store.jsx';
import { addDays, fromKey, todayKey, weekdayLabel } from '../lib/dates.js';
import { movingAverage, proteinTarget } from '../lib/calc.js';
import { Button, Card, Field, Modal, NumberInput, ProgressBar, inputCls, useToast } from '../components/ui.jsx';

export default function Nutrition() {
  const data = useData();
  const { nutrition, foods, settings, bodyweight } = data;
  const [date, setDate] = useState(todayKey());
  const [manage, setManage] = useState(false);
  const [editFood, setEditFood] = useState(null);
  const [toast, showToast] = useToast();
  const doc = nutrition[date] || { kcal: 0, protein: 0, entries: [] };
  const entries = doc.entries || [];

  const weightRef = movingAverage(bodyweight, date) ?? movingAverage(bodyweight, addDays(date, -7)) ?? 50;
  const pTarget = proteinTarget(settings, weightRef);

  const write = (nextEntries, patch = {}) => {
    const kcal = nextEntries.reduce((a, e) => a + (Number(e.kcal) || 0), 0);
    const protein = nextEntries.reduce((a, e) => a + (Number(e.protein) || 0), 0);
    data.setNutrition(date, { ...doc, ...patch, entries: nextEntries, kcal: Math.round(kcal), protein: Math.round(protein * 10) / 10 });
  };

  const addFood = (f) => {
    write([...entries, { foodId: f.id, name: f.name, kcal: f.kcal, protein: f.protein }]);
    const { id, ...rest } = f;
    data.saveFood({ id, ...rest, uses: (f.uses || 0) + 1 });
    showToast(`${f.name} を追加`);
  };

  const kcalRest = settings.targetKcal - Math.round(doc.kcal || 0);
  const pRest = pTarget - Math.round(doc.protein || 0);

  return (
    <div className="space-y-3 pt-2">
      <header className="flex items-center justify-between">
        <button type="button" className="px-3 py-2 text-slate-400" onClick={() => setDate(addDays(date, -1))}>
          ◀
        </button>
        <h1 className="text-lg font-bold">
          {date === todayKey() ? '今日' : `${fromKey(date).getMonth() + 1}/${fromKey(date).getDate()}`}（{weekdayLabel(date)}）の食事
        </h1>
        <button
          type="button"
          className="px-3 py-2 text-slate-400 disabled:opacity-20"
          disabled={date >= todayKey()}
          onClick={() => setDate(addDays(date, 1))}
        >
          ▶
        </button>
      </header>

      <Card>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-slate-400">カロリー</div>
            <div className="text-2xl font-bold tabular-nums">{Math.round(doc.kcal || 0)}</div>
            <div className="text-xs text-slate-400 mb-1.5">
              目標 {settings.targetKcal} ・ {kcalRest > 0 ? `残り ${kcalRest}` : <span className="text-emerald-400">達成</span>}
            </div>
            <ProgressBar value={doc.kcal || 0} target={settings.targetKcal} />
          </div>
          <div>
            <div className="text-xs text-slate-400">タンパク質</div>
            <div className="text-2xl font-bold tabular-nums">{Math.round(doc.protein || 0)}g</div>
            <div className="text-xs text-slate-400 mb-1.5">
              目標 {pTarget}g ・ {pRest > 0 ? `残り ${pRest}g` : <span className="text-emerald-400">達成</span>}
            </div>
            <ProgressBar value={doc.protein || 0} target={pTarget} color="bg-sky-500" />
          </div>
        </div>
      </Card>

      <Card
        title="マイ食品（タップで加算）"
        right={
          <button type="button" className="text-xs text-emerald-400" onClick={() => setManage((v) => !v)}>
            {manage ? '完了' : '編集'}
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {foods.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => (manage ? setEditFood(f) : addFood(f))}
              className={`text-left rounded-xl p-2.5 active:bg-emerald-600/30 ${manage ? 'bg-slate-800 border border-dashed border-slate-600' : 'bg-slate-800'}`}
            >
              <div className="text-sm leading-tight line-clamp-2">{f.name}</div>
              <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
                {f.kcal}kcal ・ P{f.protein}g
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setEditFood({ name: '', kcal: null, protein: null })}
            className="rounded-xl p-2.5 border border-dashed border-slate-700 text-slate-400 text-sm"
          >
            ＋ マイ食品を登録
          </button>
        </div>
      </Card>

      <DirectInput
        onAdd={(e, register) => {
          write([...entries, e]);
          if (register && e.name) data.saveFood({ name: e.name, kcal: e.kcal, protein: e.protein, uses: 1 });
          showToast('追加しました');
        }}
      />

      <Card title={`記録（${entries.length}件）`}>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">まだ記録がありません</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {entries.map((e, i) => (
              <li key={i} className="flex items-center gap-2 py-2 text-sm">
                <span className="flex-1 truncate">{e.name || '直接入力'}</span>
                <span className="tabular-nums text-slate-300">{e.kcal}kcal</span>
                <span className="tabular-nums text-slate-400 w-14 text-right">P{e.protein}g</span>
                <button
                  type="button"
                  className="text-slate-500 px-2"
                  aria-label="削除"
                  onClick={() => write(entries.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="食事メモ（任意）">
        <textarea
          className={`${inputCls} text-sm`}
          rows={2}
          placeholder="外食の内容など。写真はClaudeのプロジェクトに送ってkcal・Pを推定"
          defaultValue={doc.memo || ''}
          key={date}
          onBlur={(e) => e.target.value !== (doc.memo || '') && write(entries, { memo: e.target.value })}
        />
      </Card>

      {editFood && (
        <FoodEditor
          food={editFood}
          onClose={() => setEditFood(null)}
          onSave={(f) => {
            data.saveFood(f);
            setEditFood(null);
          }}
          onDelete={
            editFood.id
              ? () => {
                  data.deleteFood(editFood.id);
                  setEditFood(null);
                }
              : null
          }
        />
      )}
      {toast}
    </div>
  );
}

function DirectInput({ onAdd }) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState(null);
  const [protein, setProtein] = useState(null);
  const [register, setRegister] = useState(false);
  const ok = kcal != null || protein != null;
  return (
    <Card title="直接入力">
      <div className="space-y-2">
        <input className={inputCls} placeholder="名前（任意）" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <NumberInput value={kcal} onChange={setKcal} placeholder="kcal" />
          <NumberInput value={protein} onChange={setProtein} placeholder="タンパク質 g" />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400 flex-1">
            <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} disabled={!name} />
            マイ食品にも登録
          </label>
          <Button
            variant="primary"
            disabled={!ok}
            onClick={() => {
              onAdd({ name: name.trim(), kcal: kcal || 0, protein: protein || 0 }, register);
              setName('');
              setKcal(null);
              setProtein(null);
              setRegister(false);
            }}
          >
            追加
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FoodEditor({ food, onSave, onClose, onDelete }) {
  const [f, setF] = useState(food);
  return (
    <Modal title={food.id ? 'マイ食品を編集' : 'マイ食品を登録'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="名前">
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="kcal">
            <NumberInput value={f.kcal} onChange={(v) => setF({ ...f, kcal: v })} />
          </Field>
          <Field label="タンパク質 g">
            <NumberInput value={f.protein} onChange={(v) => setF({ ...f, protein: v })} />
          </Field>
        </div>
        <div className="flex gap-2">
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              削除
            </Button>
          )}
          <Button
            variant="primary"
            className="flex-1"
            disabled={!f.name}
            onClick={() => onSave({ ...f, kcal: f.kcal || 0, protein: f.protein || 0 })}
          >
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}
