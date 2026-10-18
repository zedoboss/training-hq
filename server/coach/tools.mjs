// The coach's tools (8.2): every coach tool in brief sections 7 and 11, run on the Mac against its database with
// the app's own rule code. Read tools answer in short lines in his formats; write tools change the same records the
// phone's screens do and send the phone what only it can do (its rest timer, a screen to open).
import { READ_TOOLS, contextLine } from './tools-read.mjs';
import { WRITE_TOOLS } from './tools-write.mjs';

export const TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];
export { contextLine };
