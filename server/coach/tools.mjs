// The coach's tools (8.2): every coach tool in brief sections 7 and 11, run on the Mac against its database with
// the app's own rule code. Read tools answer in short lines in his formats; write tools change the same records the
// phone's screens do and send the phone what only it can do (its rest timer, a screen to open).
import { READ_TOOLS, contextLine } from './tools-read.mjs';
import { WRITE_TOOLS } from './tools-write.mjs';
import { APP_TOOLS } from './tools-app.mjs';

// APP_TOOLS (Tue 10/20): the coach works the app itself: screens, the workout in progress, settings, the phone.
export const TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, ...APP_TOOLS];
export { contextLine };
