/**
 * register.ts — the call commands, in the order `telenow --help` lists them.
 *
 * Files in this folder:
 *   list_calls.ts      telenow calls list            the org's calls (short view, pages)
 *   get_call.ts        telenow calls get             one call with its transcript
 *   get_transcript.ts  telenow calls transcript      the transcript as text or JSON
 *   call_cost.ts       telenow calls cost            what one call was charged
 *   call_insights.ts   telenow calls insights        summary, sentiment, topics (--generate)
 *   call_trace.ts      telenow calls trace           the debug timeline (summary; --out saves it)
 *   call_recording.ts  telenow calls recording       a call's recordings; --out saves one
 *   live_calls.ts      telenow calls live            calls going on now, per agent
 *   export_calls.ts    telenow calls export          the calls as a CSV file (--out)
 *   export_columns.ts  telenow calls export-columns  the columns an export can write
 *   place_call.ts      telenow call place            dial one person (asks first, or --yes)
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { callCostCommand } from './call_cost.js';
import { callInsightsCommand } from './call_insights.js';
import { callRecordingCommand } from './call_recording.js';
import { callTraceCommand } from './call_trace.js';
import { exportCallsCommand } from './export_calls.js';
import { exportColumnsCommand } from './export_columns.js';
import { getCallCommand } from './get_call.js';
import { getTranscriptCommand } from './get_transcript.js';
import { listCallsCommand } from './list_calls.js';
import { liveCallsCommand } from './live_calls.js';
import { placeCallCommand } from './place_call.js';

export const callCommands: CommandSpec[] = [
  listCallsCommand,
  getCallCommand,
  getTranscriptCommand,
  callCostCommand,
  callInsightsCommand,
  callTraceCommand,
  callRecordingCommand,
  liveCallsCommand,
  exportCallsCommand,
  exportColumnsCommand,
  placeCallCommand,
];
