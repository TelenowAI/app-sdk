/**
 * local_changes.ts — what the local files change compared with the agent on the server.
 *
 * In here: `compareWithServer` and `promptText`. The prompt is compared with surrounding
 * whitespace trimmed — the dashboard trims it on Publish too, so an editor's final newline is
 * not a change. The flow is compared by content (`stableJson`), so key order and indentation
 * are not changes either.
 * Not in here: reading the files (`prompt_files.ts`) or the agent (`agent_state.ts`).
 * Called by: `diff_prompt.ts`, `push_prompt.ts`.
 */

import { isFlowAgent, metadataOf, stableJson, type AgentRow } from './agent_state.js';
import type { PulledFiles } from './prompt_files.js';

export interface LocalChanges {
  promptChanged: boolean;
  flowChanged: boolean;
  /** Both sides as compared: trimmed prompt text with one final newline; flow as stable JSON. */
  serverPrompt: string;
  localPrompt: string;
  serverFlow: string | null;
  localFlow: string | null;
}

/** Trimmed, with one final newline (empty stays empty) — the form the CLI compares and shows. */
export function promptText(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  return t.length > 0 ? t + '\n' : '';
}

export function compareWithServer(local: PulledFiles, agent: AgentRow): LocalChanges {
  const serverPrompt = promptText(typeof agent.system_prompt === 'string' ? agent.system_prompt : '');
  const localPrompt = promptText(local.prompt);
  const serverFlow = isFlowAgent(agent) ? stableJson(metadataOf(agent).flow) : null;
  const localFlow = local.meta.isFlow ? stableJson(local.flow) : null;
  return {
    promptChanged: serverPrompt !== localPrompt,
    // Only a pulled flow is ever pushed; a server flow the files never had is not "changed".
    flowChanged: localFlow !== null && localFlow !== serverFlow,
    serverPrompt,
    localPrompt,
    serverFlow,
    localFlow,
  };
}
