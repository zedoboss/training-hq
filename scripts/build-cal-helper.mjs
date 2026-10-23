// Builds THQ Calendar, the small background app that writes the backup reminders into his iCloud calendar without the
// Calendar app (server/cal-helper/main.swift), into ~/Library/Application Support/TrainingHQ/THQ Calendar.app.
//   node scripts/build-cal-helper.mjs             build it (needs the Command Line Tools' swiftc)
//   node scripts/build-cal-helper.mjs --request   build it, then ask macOS for calendar access (he clicks Allow)
// macOS remembers his answer for this build; a rebuilt app may ask again, so build only when main.swift changes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CODE_DIR } from '../server/config.mjs';
import { HELPER_APP, HELPER_ID } from '../server/icloud-calendar.mjs';

const why = 'Training HQ keeps its backup reminders in your “Training HQ Backup” calendar, so your iPhone still rings them when the Mac is off.';
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${HELPER_ID}</string>
  <key>CFBundleName</key><string>THQ Calendar</string>
  <key>CFBundleDisplayName</key><string>THQ Calendar</string>
  <key>CFBundleExecutable</key><string>thqcal</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSCalendarsFullAccessUsageDescription</key><string>${why}</string>
  <key>NSCalendarsUsageDescription</key><string>${why}</string>
</dict>
</plist>
`;

const macos = join(HELPER_APP, 'Contents', 'MacOS');
rmSync(HELPER_APP, { recursive: true, force: true });
mkdirSync(macos, { recursive: true });
writeFileSync(join(HELPER_APP, 'Contents', 'Info.plist'), plist);
execFileSync('swiftc', ['-O', '-swift-version', '5', '-framework', 'EventKit', join(CODE_DIR, 'server', 'cal-helper', 'main.swift'), '-o', join(macos, 'thqcal')], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--sign', '-', '--identifier', HELPER_ID, HELPER_APP], { stdio: 'inherit' });
console.log(`Built ${HELPER_APP}`);

if (process.argv.includes('--request')) {
  const out = join(tmpdir(), `thq-cal-${process.pid}.txt`);
  console.log('Asking macOS for calendar access: click Allow on the Mac.');
  execFileSync('open', ['-W', '-g', '-n', '-a', HELPER_APP, '--args', '--request', out], { stdio: 'inherit', timeout: 130000 });
  console.log(readFileSync(out, 'utf8').trim());
  rmSync(out, { force: true });
}
