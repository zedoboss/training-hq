// Prints a one-time 6-digit pairing code, valid for 10 minutes. Run on the Mac:
//   node server/pair.mjs
// Enter the code in the app under Settings > Pair with Mac.
import { paths, loadConfig } from './config.mjs';
import { openStore } from './store.mjs';

const p = paths();
loadConfig(p);
const store = openStore(p.dbFile);
const { code, expiresAt } = store.createPairingCode();
store.close();
const until = new Date(expiresAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
console.log(`Pairing code: ${code.slice(0, 3)} ${code.slice(3)}  (valid until ${until})`);
