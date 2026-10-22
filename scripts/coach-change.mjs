// File a change for the coach from the Mac (Thu 10/22): the same request the coach's request_change tool files, for
// a chat on the Mac that hears his complaint. The server's builder picks it up within 15 seconds and answers in Talk.
// Safe while the server runs (the database allows a second reader and writer).
//   node scripts/coach-change.mjs --said "<his words>" [--about "<the messages he means>"] [--want "<what instead>"]
//     [--kind personality|behaviour|bug]
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { paths } from '../server/config.mjs';
import { openStore } from '../server/store.mjs';
import { phoneZone } from '../server/notify.mjs';
import { newChange, COL, KINDS } from '../server/coach/changes.mjs';

const { values: a } = parseArgs({ options: { said: { type: 'string' }, about: { type: 'string' }, want: { type: 'string' }, kind: { type: 'string' } } });
if (!a.said) { console.error('Usage: node scripts/coach-change.mjs --said "<his words>" [--about ...] [--want ...] [--kind personality|behaviour|bug]'); process.exit(1); }
if (a.kind && !KINDS.includes(a.kind)) { console.error(`--kind is one of ${KINDS.join(', ')}`); process.exit(1); }

const { dbFile } = paths();
if (!existsSync(dbFile)) { console.error(`No database at ${dbFile}.`); process.exit(1); }
const store = openStore(dbFile);
const messages = store.listRecords('coach-messages').map((r) => r.data).filter(Boolean);
const c = newChange({ said: a.said, about: a.about, want: a.want, kind: a.kind, tz: phoneZone(store), messages });
store.writeLocal(COL, c.id, c);
store.close();
console.log(`Queued ${c.id}: the server's builder starts it within 15 seconds (log: logs/coach-changes/${c.id}.log in the private folder).`);
