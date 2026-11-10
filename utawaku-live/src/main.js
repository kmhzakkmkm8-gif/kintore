import { Engine } from './engine.js';
import { GROUPS, PARAMS, PARAM_MAP, SCENE_KEYS } from './params.js';
import { exportJSON, importJSON, loadState, saveState } from './storage.js';

const $ = (s) => document.querySelector(s);
const engine = new Engine();
let state = loadState();
engine.values = { ...state.values };

const OPEN_BY_DEFAULT = new Set(['input', 'vocal', 'rider', 'reverb', 'throw', 'music', 'master', 'monitor']);
const STAT_BADGE = {
  gate: () => fmtGr(engine.stats.gate?.gr),
  comp1: () => fmtGr(engine.stats.c1?.gr),
  deess: () => fmtGr(engine.stats.ds?.gr),
  comp2: () => fmtGr(engine.stats.c2?.gr),
  rider: () => (engine.stats.rider ? `${signed(engine.stats.rider.gain)} dB` : ''),
  carve: () => (engine.stats.carve ? `${engine.stats.carve.carve.toFixed(1)} dB` : ''),
  music: () => {
    const a = engine.stats.autogain;
    return a ? `${Number.isFinite(a.lufs) ? a.lufs.toFixed(1) : '—'} LU ${signed(a.gain)}` : '';
  },
  master: () => {
    const g = engine.stats.glue?.gr ?? 0;
    const l = engine.stats.limiter?.gr ?? 0;
    return engine.stats.glue ? `C ${g.toFixed(1)} L ${l.toFixed(1)}` : '';
  },
  delay: () => (engine.delaySeconds ? `${Math.round(engine.delaySeconds * 1000)} ms` : ''),
};
const fmtGr = (g) => (g == null ? '' : g < 0.05 ? '0.0 dB' : `-${g.toFixed(1)} dB`);
const signed = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;

// ---------- 永続化 ----------
function persist() {
  state.values = { ...engine.values };
  saveState(state);
}

// ---------- コントロール生成 ----------
const controls = new Map();

function fmt(d, v) {
  if (d.type === 'toggle') return v ? 'ON' : 'OFF';
  if (d.unit === 'dB' && v <= -60 && d.min <= -60) return 'OFF';
  const digits = d.step < 0.1 ? 2 : d.step < 1 ? 1 : 0;
  return `${Number(v).toFixed(digits)}${d.unit && d.unit !== '%' ? '' : d.unit}`;
}

function makeControl(d) {
  const row = document.createElement('div');
  const id = `p-${d.id}`;
  if (d.type === 'select') {
    row.className = 'row select';
    row.innerHTML = `<label for="${id}">${d.label}</label><select id="${id}">${d.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
    const el = row.querySelector('select');
    el.value = engine.values[d.id];
    el.addEventListener('change', () => { engine.set(d.id, el.value); persist(); });
    controls.set(d.id, { set: (v) => { el.value = v; } });
  } else if (d.type === 'toggle') {
    row.className = 'row toggle';
    row.innerHTML = `<label for="${id}">${d.label}</label><input type="checkbox" class="switch" id="${id}">`;
    const el = row.querySelector('input');
    el.checked = !!engine.values[d.id];
    el.addEventListener('change', () => { engine.set(d.id, el.checked ? 1 : 0); persist(); });
    controls.set(d.id, { set: (v) => { el.checked = !!v; } });
  } else {
    row.className = 'row';
    row.innerHTML = `<label for="${id}" title="${d.unit}">${d.label}${d.unit ? ` <small>${d.unit}</small>` : ''}</label>
      <input type="range" id="${id}" min="${d.min}" max="${d.max}" step="${d.step}"><output></output>`;
    const el = row.querySelector('input');
    const out = row.querySelector('output');
    const show = (v) => { el.value = v; out.textContent = fmt(d, v); };
    show(engine.values[d.id]);
    el.addEventListener('input', () => { const v = Number(el.value); out.textContent = fmt(d, v); engine.set(d.id, v); persist(); });
    el.addEventListener('dblclick', () => { show(d.def); engine.set(d.id, d.def); persist(); });
    el.title = 'ダブルクリックで初期値';
    controls.set(d.id, { set: show });
  }
  if (d.hint) {
    const h = document.createElement('div');
    h.className = 'rowhint';
    h.textContent = d.hint;
    row.appendChild(h);
  }
  return row;
}

function buildConsole() {
  for (const g of GROUPS) {
    const strip = document.querySelector(`.strip[data-strip="${g.strip}"]`);
    const det = document.createElement('details');
    det.className = 'mod';
    det.open = OPEN_BY_DEFAULT.has(g.id);
    det.innerHTML = `<summary><span class="ttl">${g.title}</span><span class="badge" data-badge="${g.id}"></span></summary><div class="rows"></div>`;
    const rows = det.querySelector('.rows');
    for (const d of PARAMS.filter((x) => x.group === g.id)) {
      if (d.id === 'sys.comp') { $('#compSlot').appendChild(makeControl(d)); continue; }
      rows.appendChild(makeControl(d));
    }
    if (g.id === 'music') {
      const b = document.createElement('button');
      b.className = 'small';
      b.textContent = '曲が変わったので再測定';
      b.addEventListener('click', () => engine.relearnMusic());
      rows.appendChild(b);
    }
    const loud = strip.querySelector('.loud');
    strip.insertBefore(det, g.strip === 'master' && g.id === 'monitor' ? null : loud ?? null);
  }
}

engine.on((type, data) => {
  if (type === 'param') controls.get(data.id)?.set(data.value);
  if (type === 'io') renderIO();
  if (type === 'panic') $('#btnPanic').classList.toggle('on', data);
});

// ---------- シーン ----------
function renderScenes() {
  const row = $('#sceneRow');
  row.innerHTML = '';
  state.scenes.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = `scene-btn${i === state.activeScene ? ' active' : ''}`;
    b.innerHTML = `<kbd>${i + 1}</kbd>${escapeHtml(s.name)}`;
    b.addEventListener('click', (e) => (e.shiftKey ? saveScene(i) : recallScene(i)));
    b.addEventListener('dblclick', () => {
      const name = prompt('シーン名', s.name);
      if (name) { s.name = name.slice(0, 24); renderScenes(); persist(); }
    });
    row.appendChild(b);
  });
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function recallScene(i) {
  const s = state.scenes[i];
  if (!s) return;
  const ramp = engine.values['sys.xfade'];
  for (const k of SCENE_KEYS) if (s.values[k] !== engine.values[k]) engine.set(k, s.values[k], ramp);
  state.activeScene = i;
  renderScenes();
  persist();
}

function saveScene(i) {
  state.scenes[i].values = Object.fromEntries(SCENE_KEYS.map((k) => [k, engine.values[k]]));
  state.activeScene = i;
  renderScenes();
  $('#sceneRow').children[i].classList.add('saved');
  persist();
  toast(`シーン ${i + 1}「${state.scenes[i].name}」に保存しました`);
}

// ---------- 入出力 ----------
async function listDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const ins = devs.filter((d) => d.kind === 'audioinput');
  const outs = devs.filter((d) => d.kind === 'audiooutput');
  const opt = (d) => `<option value="${d.deviceId}">${escapeHtml(d.label || '(名称未取得)')}</option>`;
  $('#selMic').innerHTML = ins.map(opt).join('');
  $('#selMusicDev').innerHTML = `<option value="">オーディオ入力から…</option>${ins.map(opt).join('')}`;
  $('#selMonOut').innerHTML = `<option value="">既定の出力</option>${outs.filter((d) => d.deviceId !== 'default').map(opt).join('')}`;
  $('#selStreamOut').innerHTML = `<option value="">（出力しない）</option>${outs.filter((d) => d.deviceId !== 'default').map(opt).join('')}`;
  if (engine.mic.deviceId) $('#selMic').value = engine.mic.deviceId;
  const dv = state.devices;
  if (dv.monOut && outs.some((d) => d.deviceId === dv.monOut)) $('#selMonOut').value = dv.monOut;
  if (dv.streamOut && outs.some((d) => d.deviceId === dv.streamOut)) $('#selStreamOut').value = dv.streamOut;
}

function renderIO() {
  const m = engine.mic;
  $('#micInfo').textContent = m.channels ? `${m.label} / ${m.channels}ch${m.channels === 1 ? '（IN 1 を選択）' : ''}` : '未接続';
  $('#musicInfo').textContent = engine.music.label;
  const c = engine.ctx;
  if (c) {
    const out = Math.round(((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000);
    $('#status').textContent = `${c.sampleRate / 1000} kHz ・ 出力レイテンシ約 ${out} ms ・ マイク ${Math.round((m.latency || 0) * 1000)} ms`;
  }
}

async function start() {
  try {
    $('#btnStart').disabled = true;
    await engine.start(state.values);
    document.body.classList.add('running');
    try {
      await engine.setMic(state.devices.mic);
    } catch (e) {
      if (state.devices.mic) await engine.setMic();
      else throw e;
    }
    await listDevices();
    if (state.devices.monOut) await engine.setMonitorSink(state.devices.monOut).catch(() => {});
    if (state.devices.streamOut) await engine.setStreamSink(state.devices.streamOut).catch(() => {});
    for (const s of ['#selMic', '#selMusicDev', '#selMonOut', '#selStreamOut', '#btnTab', '#fileMusic', '#btnLatency', '#btnRec', '#btnPanic']) $(s).disabled = false;
    $('#btnStart').textContent = '● 稼働中';
    renderIO();
    setInterval(renderIO, 3000);
    requestAnimationFrame(drawMeters);
    initMidi();
  } catch (e) {
    $('#btnStart').disabled = false;
    toast(`起動できませんでした: ${e.message}`, true);
    console.error(e);
  }
}

function bindIO() {
  $('#btnStart').addEventListener('click', start);
  $('#selMic').addEventListener('change', async (e) => {
    try { await engine.setMic(e.target.value); state.devices.mic = e.target.value; persist(); } catch (err) { toast(err.message, true); }
  });
  $('#btnTab').addEventListener('click', async () => {
    try { await engine.captureTab(); $('#playerSlot').innerHTML = ''; toast('タブ音声を取り込みました。YouTube 側の音はこのミキサー経由でのみ聞こえます'); } catch (err) { if (err.name !== 'NotAllowedError') toast(err.message, true); }
  });
  $('#selMusicDev').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    try { await engine.setMusicDevice(e.target.value); $('#playerSlot').innerHTML = ''; } catch (err) { toast(err.message, true); }
  });
  $('#fileMusic').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const el = engine.loadMusicFile(f);
    $('#playerSlot').replaceChildren(el);
  });
  $('#selMonOut').addEventListener('change', async (e) => {
    try { await engine.setMonitorSink(e.target.value); state.devices.monOut = e.target.value; persist(); } catch (err) { toast(err.message, true); }
  });
  $('#selStreamOut').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (id && id === $('#selMonOut').value) toast('モニターと同じデバイスです。配信用には仮想オーディオデバイスを選んでください', true);
    try { await engine.setStreamSink(id); state.devices.streamOut = id; persist(); } catch (err) { toast(err.message, true); }
  });
  $('#btnLatency').addEventListener('click', () => {
    const ms = engine.estimateLatencyMs();
    engine.set('sys.comp', ms);
    persist();
    $('#latInfo').textContent = `推定 ${ms} ms（録音して微調整を）`;
  });
  $('#btnRec').addEventListener('click', () => {
    const b = $('#btnRec');
    if (engine.recorder) { engine.stopRecording(); b.classList.remove('rec'); b.textContent = '● 録音'; }
    else { engine.startRecording(); b.classList.add('rec'); b.textContent = '■ 停止して保存'; }
  });
  $('#btnPanic').addEventListener('click', () => engine.panic(!engine.panicked));
  $('#btnLoudReset').addEventListener('click', () => engine.resetLoudness());
  const thr = $('#btnThrow');
  const down = () => { engine.throwManual(true); thr.classList.add('held'); };
  const up = () => { engine.throwManual(false); thr.classList.remove('held'); };
  thr.addEventListener('pointerdown', down);
  thr.addEventListener('pointerup', up);
  thr.addEventListener('pointerleave', up);
  $('#btnTap').addEventListener('click', tap);
  $('#btnExport').addEventListener('click', () => {
    persist();
    const blob = new Blob([exportJSON({ values: engine.values, scenes: state.scenes, activeScene: state.activeScene, devices: {} })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'utawaku-live-preset.json';
    a.click();
  });
  $('#fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const devices = state.devices;
      state = importJSON(await f.text());
      state.devices = devices;
      for (const d of PARAMS) engine.set(d.id, state.values[d.id], 0.2);
      renderScenes();
      persist();
      toast('プリセットを読み込みました');
    } catch (err) { toast(err.message, true); }
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => engine.ctx && listDevices());
}

// ---------- タップテンポ ----------
let taps = [];
function tap() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length >= 2) {
    const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    const bpm = Math.round((60000 / iv) * 2) / 2;
    const d = PARAM_MAP['dly.bpm'];
    engine.set('dly.bpm', Math.min(d.max, Math.max(d.min, bpm)));
    persist();
  }
}

// ---------- キーボード / MIDI ----------
function bindKeys() {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') return;
    if (t instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const num = /^Digit([1-6])$/.exec(e.code);
    if (num) { e.preventDefault(); const i = Number(num[1]) - 1; e.shiftKey ? saveScene(i) : recallScene(i); return; }
    if (e.code === 'KeyD' && !e.repeat) { engine.throwManual(true); $('#btnThrow').classList.add('held'); }
    if (e.code === 'KeyT' && !e.repeat) tap();
    if (e.code === 'Escape' && engine.ctx) engine.panic(!engine.panicked);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyD') { engine.throwManual(false); $('#btnThrow').classList.remove('held'); }
  });
}

/** MIDI：プログラムチェンジ 0-5 / ノート 36-41 → シーン、CC64（サステインペダル）→ 手動スロー。フットスイッチ運用向け */
async function initMidi() {
  if (!navigator.requestMIDIAccess) { $('#midiInfo').textContent = 'MIDI: 非対応'; return; }
  try {
    const access = await navigator.requestMIDIAccess();
    const hook = () => {
      const inputs = [...access.inputs.values()];
      $('#midiInfo').textContent = inputs.length ? `MIDI: ${inputs.map((i) => i.name).join(', ')}` : 'MIDI: 未接続';
      for (const inp of inputs) {
        inp.onmidimessage = (m) => {
          const [st, d1, d2] = m.data;
          const kind = st & 0xf0;
          if (kind === 0xc0 && d1 < state.scenes.length) recallScene(d1);
          if (kind === 0x90 && d2 > 0 && d1 >= 36 && d1 < 36 + state.scenes.length) recallScene(d1 - 36);
          if (kind === 0xb0 && d1 === 64) engine.throwManual(d2 >= 64);
        };
      }
    };
    hook();
    access.onstatechange = hook;
  } catch {
    $('#midiInfo').textContent = 'MIDI: 許可されていません';
  }
}

// ---------- メーター ----------
const dbPos = (lin) => {
  const db = lin > 1e-6 ? 20 * Math.log10(lin) : -120;
  return Math.max(0, Math.min(1, (db + 60) / 60));
};
function drawBar(canvas, st, stereo) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (!st) return;
  const rows = stereo ? 2 : 1;
  const h = H / rows;
  for (let r = 0; r < rows; r++) {
    const pk = dbPos(st.peak[r]);
    const rm = dbPos(st.rms[r] * Math.SQRT2);
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#3ddc97'); grad.addColorStop(0.75, '#3ddc97'); grad.addColorStop(0.9, '#ffc857'); grad.addColorStop(1, '#ff5a5a');
    g.fillStyle = grad;
    g.globalAlpha = 0.45;
    g.fillRect(0, r * h + 1, pk * W, h - 2);
    g.globalAlpha = 1;
    g.fillRect(0, r * h + 1, rm * W, h - 2);
  }
  g.fillStyle = 'rgba(255,255,255,.25)';
  for (const db of [-48, -36, -24, -12, -6]) g.fillRect(((db + 60) / 60) * W, 0, 1, H);
  if (st.clip) { g.fillStyle = '#ff5a5a'; g.fillRect(W - 4, 0, 4, H); }
}

function lufsCls(v, target = -14) {
  if (!Number.isFinite(v)) return '';
  if (v > target + 1) return 'hi';
  if (v < target - 4) return 'lo';
  return 'ok';
}

function drawMeters() {
  const s = engine.stats;
  drawBar($('#mVocal'), s.vocal, false);
  drawBar($('#mMusic'), s.music, true);
  drawBar($('#mMaster'), s.master, true);
  if (s.master) {
    const set = (id, v, cls = true) => {
      const el = $(id);
      el.textContent = Number.isFinite(v) ? v.toFixed(1) : '—';
      el.className = cls ? lufsCls(v) : '';
    };
    set('#lM', s.master.m);
    set('#lS', s.master.s);
    set('#lI', s.master.i);
    const pk = Math.max(...s.master.peak);
    $('#lP').textContent = pk > 0 ? (20 * Math.log10(pk)).toFixed(1) : '—';
  }
  for (const [g, f] of Object.entries(STAT_BADGE)) {
    const el = document.querySelector(`[data-badge="${g}"]`);
    if (el) el.textContent = f();
  }
  const th = s.throw?.throw ?? 0;
  $('#throwChip').classList.toggle('hot', th > 0.3);
  $('#bpmShow').textContent = engine.values['dly.bpm'];
  requestAnimationFrame(drawMeters);
}

// ---------- 通知 ----------
let toastTimer;
function toast(msg, err = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); document.body.appendChild(el); }
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), err ? 7000 : 3500);
}

// ---------- 初期化 ----------
buildConsole();
renderScenes();
bindIO();
bindKeys();
$('#bpmShow').textContent = engine.values['dly.bpm'];
if (!window.AudioWorkletNode || !navigator.mediaDevices?.getDisplayMedia) {
  toast('このブラウザは未対応の機能があります。PC版 Chrome / Edge を推奨します', true);
}
