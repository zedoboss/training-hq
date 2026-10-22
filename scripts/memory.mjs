// The coach's memory from a chat on the Mac (Thu 10/22): the same timeline and recall the coach's tools give, read
// from the Mac's database (it only reads). For builders and Claude chats that need to know what happened when.
//   node scripts/memory.mjs timeline <YYYY-MM-DD> [--kinds meals,workouts]
//   node scripts/memory.mjs timeline --from "<YYYY-MM-DD HH:MM>" --to "<YYYY-MM-DD HH:MM>" [--kinds ...]
//   node scripts/memory.mjs recall "<words>" [--from YYYY-MM-DD] [--to YYYY-MM-DD]
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { paths } from '../server/config.mjs';
import { openStore } from '../server/store.mjs';
import { phoneZone } from '../server/notify.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { timelineText, recallText } from '../server/coach/memory.mjs';

const { values: a, positionals: [what, arg] } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' }, kinds: { type: 'string' }, limit: { type: 'string' } } });
if (!['timeline', 'recall'].includes(what) || (what === 'recall' && !arg)) {
  console.error('Usage: node scripts/memory.mjs timeline <YYYY-MM-DD> [--kinds meals,workouts] | timeline --from "<YYYY-MM-DD HH:MM>" --to "..." | recall "<words>" [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
  process.exit(1);
}
const { dbFile } = paths();
if (!existsSync(dbFile)) { console.error(`No database at ${dbFile}.`); process.exit(1); }
const store = openStore(dbFile);
try {
  const s = snapshot(store, { tz: phoneZone(store), now: Date.now() });
  const kinds = a.kinds ? a.kinds.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
  console.log(what === 'timeline'
    ? timelineText(s, { date: arg || (a.from ? null : s.today), from: a.from, to: a.to, kinds })
    : recallText(s, { query: arg, from: a.from, to: a.to, limit: a.limit ? Number(a.limit) : undefined }));
} finally { store.close(); }
