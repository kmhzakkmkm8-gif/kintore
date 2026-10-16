// 日付はすべて端末ローカルの YYYY-MM-DD 文字列で扱う

const pad = (n) => String(n).padStart(2, '0');

export function toKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey() {
  return toKey(new Date());
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function diffDays(a, b) {
  // b - a（日数）
  return Math.round((fromKey(b) - fromKey(a)) / 86400000);
}

// 月曜始まりの週の開始日
export function weekStart(key) {
  const d = fromKey(key);
  const dow = (d.getDay() + 6) % 7; // 月=0 … 日=6
  d.setDate(d.getDate() - dow);
  return toKey(d);
}

export function rangeKeys(start, end) {
  const out = [];
  for (let k = start; k <= end; k = addDays(k, 1)) out.push(k);
  return out;
}

export function shortLabel(key) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function weekdayLabel(key) {
  return '日月火水木金土'[fromKey(key).getDay()];
}
