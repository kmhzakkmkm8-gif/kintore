import { DEFAULTS, SCENE_KEYS, defaultScenes, sanitizeValues } from './params.js';

const KEY = 'utawaku-live.v1';

export function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    raw = null;
  }
  const scenes = defaultScenes();
  if (Array.isArray(raw?.scenes)) {
    raw.scenes.slice(0, scenes.length).forEach((s, i) => {
      if (typeof s?.name === 'string') scenes[i].name = s.name.slice(0, 24);
      scenes[i].values = sanitizeValues({ ...scenes[i].values, ...s?.values }, SCENE_KEYS);
    });
  }
  return {
    values: sanitizeValues({ ...DEFAULTS, ...raw?.values }),
    scenes,
    activeScene: Number.isInteger(raw?.activeScene) ? raw.activeScene : 0,
    devices: raw?.devices ?? {},
  };
}

let timer = null;
export function saveState(state) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* プライベートモード等では保存しない */
    }
  }, 300);
}

export function exportJSON(state) {
  return JSON.stringify({ app: 'utawaku-live', version: 1, ...state }, null, 2);
}

export function importJSON(text) {
  const raw = JSON.parse(text);
  if (raw?.app !== 'utawaku-live') throw new Error('UTAWAKU LIVE のプリセットファイルではありません');
  localStorage.setItem(KEY, JSON.stringify(raw));
  return loadState();
}
