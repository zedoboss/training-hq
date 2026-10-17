// Prints a one-time 6-digit pairing code, valid for 10 minutes (or --minutes N, up to 60). Run on the Mac:
//   node server/pair.mjs
//   node server/pair.mjs --minutes 30
// Enter the code in the app under Settings > Pair with Mac.
import { paths, loadConfig } from './config.mjs';
import { openStore } from './store.mjs';

const p = paths();
loadConfig(p);
const store = openStore(p.dbFile);
const i = process.argv.indexOf('--minutes');
const minutes = i > 0 ? Math.min(60, Math.max(1, Number(process.argv[i + 1]) || 10)) : 10;
const { code, expiresAt } = store.createPairingCode(minutes * 60 * 1000);
store.close();
const until = new Date(expiresAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
console.log(`Pairing code: ${code.slice(0, 3)} ${code.slice(3)}  (valid until ${until})`);
