// Installs (or with --uninstall removes) the launchd agent that runs the Training HQ server at login.
// The server runs under `caffeinate -i -s`, which keeps the Mac from sleeping while it is plugged in.
//   node scripts/install-mac-service.mjs
//   node scripts/install-mac-service.mjs --uninstall
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { CODE_DIR, paths } from '../server/config.mjs';

const LABEL = 'com.traininghq.server';
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logDir = join(homedir(), 'Library', 'Logs', 'TrainingHQ');
const domain = `gui/${userInfo().uid}`;
const node = existsSync('/opt/homebrew/bin/node') ? '/opt/homebrew/bin/node' : process.execPath;

const launchctl = (...args) => {
  try { return execFileSync('/bin/launchctl', args, { stdio: 'pipe' }).toString(); } catch (e) { return e.stderr?.toString() || String(e); }
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

if (process.argv.includes('--uninstall')) {
  launchctl('bootout', `${domain}/${LABEL}`);
  rmSync(plistPath, { force: true });
  console.log('Training HQ server removed from login items.');
  process.exit(0);
}

mkdirSync(logDir, { recursive: true });
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-i</string><string>-s</string>
    <string>${esc(node)}</string><string>${esc(join(CODE_DIR, 'server', 'index.mjs'))}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>TRAINING_HQ_PRIVATE</key><string>${esc(paths().privateDir)}</string></dict>
  <key>WorkingDirectory</key><string>${esc(CODE_DIR)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${esc(join(logDir, 'server.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(join(logDir, 'server.log'))}</string>
</dict>
</plist>
`;
mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
writeFileSync(plistPath, plist);
launchctl('bootout', `${domain}/${LABEL}`);
const out = launchctl('bootstrap', domain, plistPath);
if (out.trim()) console.log(out.trim());
launchctl('kickstart', '-k', `${domain}/${LABEL}`);
console.log(`Installed ${plistPath}\nLogs: ${join(logDir, 'server.log')}`);
