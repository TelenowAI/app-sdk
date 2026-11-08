/**
 * prompt_files.ts — the local folder `telenow prompts pull` writes and `push` reads.
 *
 * Layout (the root is `--dir`, default `.telenow` in the current folder):
 *   <root>/.gitignore              `*` — written only when the root is created, so git ignores
 *                                  the folder by default; delete it to commit your prompts
 *   <root>/agents/<agent-id>/
 *     agent.json                   agentId, name, baseUrl, version, isFlow, pulledAt, pushedAt,
 *                                  and the sha256 of each file as last pulled or pushed
 *     prompt.md                    the live `system_prompt` (a flow agent's shared prompt)
 *     flow.json                    the live `metadata.flow` — flow agents only
 * Nothing else is written: no provider settings, keys or tokens, not even masked ones.
 * The hashes let `pull` see edits that were never pushed (`unpushedEdits`) instead of
 * overwriting them.
 *
 * In here: `DIR_OPTION`, `checkSameServer`, `rootFolder`, `agentFolder`, `writePulled`, `readPulled`, `saveMeta`,
 * `fileHashes`, `unpushedEdits`, `PulledMeta`.
 * Not in here: what is compared or sent (`diff_prompt.ts`, `push_prompt.ts`).
 * Called by: `pull_prompt.ts`, `diff_prompt.ts`, `push_prompt.ts`.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CliError, EXIT } from '../../core/cli_error.js';
import type { OptionSpec } from '../../core/command_spec.js';

export const DEFAULT_DIR = '.telenow';

/** `--dir`, shared by pull, diff and push. */
export const DIR_OPTION: OptionSpec = {
  type: 'string',
  value: '<path>',
  help: `folder for pulled agents (default ${DEFAULT_DIR} in the current folder)`,
};
const META = 'agent.json';
const PROMPT = 'prompt.md';
const FLOW = 'flow.json';

export interface PulledMeta {
  agentId: string;
  name: string | null;
  baseUrl: string;
  /** The agent's version the files were read at; `null` when the server did not say. */
  version: number | null;
  isFlow: boolean;
  pulledAt: string;
  pushedAt?: string;
  /** sha256 of `prompt.md` / `flow.json` as the CLI last wrote or pushed them. */
  sha256?: Record<string, string>;
}

export interface PulledFiles {
  meta: PulledMeta;
  prompt: string;
  /** Parsed `flow.json`; absent for a single-prompt agent. */
  flow?: unknown;
  folder: string;
}

/** Agent ids are UUIDs; anything with a path character is refused before it touches the disk. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Files pulled from one server are never compared with, or pushed to, another. */
export function checkSameServer(pulledFrom: string, talkingTo: string): void {
  if (pulledFrom !== talkingTo) {
    throw new CliError(
      `these files were pulled from ${pulledFrom}, but this command talks to ${talkingTo}. ` +
        'Use the same --base-url / profile, or pull again from this server into another --dir.',
      EXIT.usage,
    );
  }
}

export function rootFolder(cwd: string, dir: string | undefined): string {
  return resolve(cwd, dir ?? DEFAULT_DIR);
}

export function agentFolder(root: string, agentId: string): string {
  if (!SAFE_ID.test(agentId)) throw new CliError(`'${agentId}' is not an agent id`, EXIT.usage);
  return join(root, 'agents', agentId);
}

export function writePulled(root: string, meta: PulledMeta, prompt: string, flow: unknown | undefined): string[] {
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, '.gitignore'), '*\n');
  }
  const folder = agentFolder(root, meta.agentId);
  mkdirSync(folder, { recursive: true });
  const text = prompt.length === 0 || prompt.endsWith('\n') ? prompt : prompt + '\n';
  writeFileSync(join(folder, PROMPT), text);
  const written = [join(folder, PROMPT)];
  const flowPath = join(folder, FLOW);
  if (flow !== undefined) {
    writeFileSync(flowPath, JSON.stringify(flow, null, 2) + '\n');
    written.push(flowPath);
  } else if (existsSync(flowPath)) {
    // The agent is no longer a flow agent; a left-over flow.json would be pushed back.
    rmSync(flowPath);
  }
  saveMeta(folder, { ...meta, sha256: fileHashes(folder) });
  written.push(join(folder, META));
  return written;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** sha256 of the prompt and flow files that exist in `folder` now. */
export function fileHashes(folder: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [PROMPT, FLOW]) {
    const p = join(folder, name);
    if (existsSync(p)) out[name] = sha256(p);
  }
  return out;
}

/** The files changed since the CLI last pulled or pushed them (empty when never pulled). */
export function unpushedEdits(root: string, agentId: string): string[] {
  const folder = agentFolder(root, agentId);
  const metaPath = join(folder, META);
  if (!existsSync(metaPath)) return [];
  let known: Record<string, string> = {};
  try {
    known = (JSON.parse(readFileSync(metaPath, 'utf8')) as PulledMeta).sha256 ?? {};
  } catch {
    return [META];
  }
  const now = fileHashes(folder);
  return [PROMPT, FLOW].filter((n) => known[n] !== now[n] && (known[n] !== undefined || now[n] !== undefined));
}

export function saveMeta(folder: string, meta: PulledMeta): void {
  writeFileSync(join(folder, META), JSON.stringify(meta, null, 2) + '\n');
}

export function readPulled(root: string, agentId: string): PulledFiles {
  const folder = agentFolder(root, agentId);
  const metaPath = join(folder, META);
  if (!existsSync(metaPath)) {
    throw new CliError(`agent ${agentId} has not been pulled into ${root}: run \`telenow prompts pull ${agentId}\``, EXIT.usage);
  }
  let meta: PulledMeta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8')) as PulledMeta;
  } catch {
    throw new CliError(`${metaPath} is not valid JSON; pull the agent again`, EXIT.usage);
  }
  const promptPath = join(folder, PROMPT);
  if (!existsSync(promptPath)) throw new CliError(`${promptPath} is missing; pull the agent again`, EXIT.usage);
  const prompt = readFileSync(promptPath, 'utf8');
  const flowPath = join(folder, FLOW);
  let flow: unknown;
  if (meta.isFlow) {
    if (!existsSync(flowPath)) throw new CliError(`${flowPath} is missing; pull the agent again`, EXIT.usage);
    try {
      flow = JSON.parse(readFileSync(flowPath, 'utf8'));
    } catch (e) {
      throw new CliError(`${flowPath} is not valid JSON: ${(e as Error).message}`, EXIT.usage);
    }
  }
  return { meta, prompt, flow, folder };
}
