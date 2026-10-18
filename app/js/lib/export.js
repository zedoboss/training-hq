// Export of everything on this device as CSV (3.6, P56). Works offline: it reads the local copy, not the Mac.
// One ZIP: workouts.csv (one row per set, every finished session, imported ones too), one CSV per stored collection
// (every field; nested values as JSON), and session photos as JPEG files. Pure functions; the screen passes data in.

const BOM = '﻿'; // so Numbers and Excel read the file as UTF-8

/** One CSV cell: quoted when it holds the separator, a quote or a line break. */
export function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (columns, rows) => BOM + [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';

const p2 = (n) => String(n).padStart(2, '0');
/** "2026-10-12 05:30" in the given zone (24-hour, sortable). */
export function localStamp(ms, tz) {
  if (ms == null) return '';
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day} ${p2(Number(p.hour) % 24)}:${p.minute}`;
}

export const WORKOUT_COLUMNS = ['date', 'start_time', 'end_time', 'duration_min', 'title', 'kind', 'day_type', 'source', 'gym', 'session_note',
  'bodyweight_kg', 'exercise', 'exercise_id', 'exercise_note', 'superset', 'set_number', 'set_type', 'weight_kg', 'reps',
  'duration_seconds', 'distance_km', 'rpe', 'set_note', 'logged_as', 'session_id'];

const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** One row per ticked set of every finished session, oldest first. Loads are total kg including the bar. */
export function workoutRows(sessions, sets, { tz } = {}) {
  const bySession = new Map();
  for (const s of sets) {
    if (s.done === false) continue;
    if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, []);
    bySession.get(s.sessionId).push(s);
  }
  const rows = [];
  for (const ses of sessions.filter((x) => x.status === 'done').sort((a, b) => a.startedAt - b.startedAt)) {
    const mine = (bySession.get(ses.id) || []).sort((a, b) => a.order - b.order);
    const base = {
      date: localStamp(ses.startedAt, tz).slice(0, 10), start_time: localStamp(ses.startedAt, tz), end_time: localStamp(ses.endedAt, tz),
      duration_min: ses.endedAt ? Math.round((ses.endedAt - ses.startedAt - (ses.pausedMs || 0)) / 60000) : null,
      title: ses.title, kind: ses.kind || 'workout', day_type: ses.dayType, source: ses.source || 'training-hq', gym: ses.gym,
      session_note: ses.note || null, bodyweight_kg: ses.bodyweightKg, session_id: ses.id,
    };
    const exercises = ses.exercises || [];
    const groups = new Map((exercises).map((e) => [e.key, []]));
    for (const s of mine) (groups.get(s.exKey) || groups.set(s.exKey, []).get(s.exKey)).push(s);
    for (const [key, list] of groups) {
      const ex = exercises.find((e) => e.key === key) || { name: '(removed exercise)' };
      list.forEach((s, i) => rows.push({
        ...base, exercise: ex.name, exercise_id: ex.exerciseId, exercise_note: ex.notes || null, superset: ex.supersetId,
        set_number: i + 1, set_type: s.type || 'normal', weight_kg: s.kg, reps: s.reps, duration_seconds: s.durationS,
        distance_km: s.distanceM != null ? round(s.distanceM / 1000) : null, rpe: s.rpe, set_note: s.note || null, logged_as: s.importedAs,
      }));
    }
  }
  return rows;
}

/** Every record of one collection: id first, then every top-level field. Pictures are left out (they go in as files). */
export function recordRows(records) {
  const keys = new Set();
  for (const r of records) for (const k of Object.keys(r || {})) keys.add(k);
  keys.delete('id');
  const columns = ['id', ...[...keys].sort()];
  const rows = records.map((r) => Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k,
    typeof v === 'string' && v.startsWith('data:') ? `(file, ${Math.round((v.length * 3) / 4 / 1024)} KB)` : v])));
  return { columns, rows: rows.sort((a, b) => String(a.id).localeCompare(String(b.id))) };
}

/** Bytes of a data: URL ("data:image/jpeg;base64,..."). */
export function dataUrlBytes(url) {
  const b64 = String(url).split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- ZIP (stored, no compression: small code, opens everywhere) ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{name, data: string | Uint8Array}] -> the bytes of a .zip file. */
export function zipFiles(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, dosTime, 2], [12, dosDate, 2], [14, crc, 4], [18, data.length, 4],
      [22, data.length, 4], [26, name.length, 2], [28, 0, 2]].forEach(([o, v, n]) => (n === 4 ? head.setUint32(o, v, true) : head.setUint16(o, v, true)));
    const cen = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, dosTime, 2], [14, dosDate, 2], [16, crc, 4], [20, data.length, 4],
      [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([o, v, n]) => (n === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
    parts.push(new Uint8Array(head.buffer), name, data);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cenSize, 4], [16, offset, 4], [20, 0, 2]]
    .forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let at = 0;
  for (const a of all) { out.set(a, at); at += a.length; }
  return out;
}

const README = `Training HQ export

workouts.csv   One row per set of every finished session (Training HQ, Hevy and Strong history).
               Loads are total kg including the bar. Times are local, 24-hour. set_type: normal, warmup,
               dropset, failure or hold. logged_as: how a hold was first logged in Hevy (e.g. "x 10").
data/*.csv     Every record stored in the app, one file per kind (sessions, sets, exercises, routines,
               settings, ...): id first, then every field; nested values are JSON.
photos/*.jpg   Session photos; meal photos as photos/meal-<meal id>-before.jpg and -after.jpg; progress
               photos as photos/progress-<date>-<front|side|back>.jpg; body scan result photos as
               photos/scan-<date>-<photo id>.jpg.
`.replace(/\n/g, '\r\n');

/**
 * Everything as files for the ZIP. data: {colName: [records]} for every collection on the device.
 * @returns {{files: Array<{name, data}>, counts: {sessions, sets, photos, collections}}}
 */
export function exportFiles(data, { tz }) {
  const sessions = data.sessions || [];
  const sets = data.sets || [];
  const workouts = workoutRows(sessions, sets, { tz });
  const files = [{ name: 'README.txt', data: README }, { name: 'workouts.csv', data: toCsv(WORKOUT_COLUMNS, workouts) }];
  const cols = Object.keys(data).filter((c) => (data[c] || []).length).sort();
  for (const col of cols) {
    const { columns, rows } = recordRows(data[col]);
    files.push({ name: `data/${col}.csv`, data: toCsv(columns, rows) });
  }
  let photos = 0;
  const fileSafe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
  for (const p of data.photos || []) {
    if (typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/jpeg')) continue;
    files.push({ name: `photos/${fileSafe(p.id)}.jpg`, data: dataUrlBytes(p.dataUrl) });
    photos++;
  }
  for (const p of data['meal-photos'] || []) {
    if (typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/jpeg')) continue;
    files.push({ name: `photos/meal-${fileSafe(p.mealId)}-${fileSafe(p.kind)}${p.kind ? '' : `-${fileSafe(p.id)}`}.jpg`, data: dataUrlBytes(p.dataUrl) });
    photos++;
  }
  for (const p of data['body-photos'] || []) {
    if (typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/jpeg')) continue;
    files.push({ name: `photos/progress-${fileSafe(p.date)}-${fileSafe(p.pose)}.jpg`, data: dataUrlBytes(p.dataUrl) });
    photos++;
  }
  for (const p of data['scan-photos'] || []) {
    if (typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/jpeg')) continue;
    files.push({ name: `photos/scan-${fileSafe(p.date)}-${fileSafe(p.id)}.jpg`, data: dataUrlBytes(p.dataUrl) });
    photos++;
  }
  const done = new Set(sessions.filter((s) => s.status === 'done').map((s) => s.id));
  return { files, counts: { sessions: done.size, sets: workouts.length, photos, collections: cols.length } };
}
