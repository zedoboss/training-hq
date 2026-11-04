// The coach's tools (8.2): every coach tool in brief sections 7 and 11, run on the Mac against its database with
// the app's own rule code. Read tools answer in short lines in his formats; write tools change the same records the
// phone's screens do and send the phone what only it can do (its rest timer, a screen to open).
import { READ_TOOLS, contextLine } from './tools-read.mjs';
import { WRITE_TOOLS } from './tools-write.mjs';
import { APP_TOOLS } from './tools-app.mjs';
import { WORKOUT_TOOLS } from './tools-workout.mjs';
import { PLAN_TOOLS } from './tools-plan.mjs';
import { FUEL_TOOLS } from './tools-fuel.mjs';
import { BODY_TOOLS } from './tools-body.mjs';
import { UNDO_TOOLS } from './tools-undo.mjs';
import { TRAINING_TOOLS } from './tools-training.mjs';

// APP_TOOLS (Tue 10/20): the coach works the app itself: screens, the workout in progress, settings, the phone.
// Thu 11/5 (his words: "What else cant u do? Figure it out and let the mac give U the tools"): the workout, plan, fuel
// and body tools cover what his screens could do that the coach could not.
export const TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, ...APP_TOOLS, ...WORKOUT_TOOLS, ...PLAN_TOOLS, ...FUEL_TOOLS, ...BODY_TOOLS, ...TRAINING_TOOLS, ...UNDO_TOOLS];
export { contextLine };
