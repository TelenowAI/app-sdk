/**
 * number_row.ts — one of the org's numbers, read for a command that is about to change it.
 *
 * In here:
 * - `numberPath(id)`: `/api/voice/numbers/<id>`, the id URL-encoded.
 * - `readNumber`: `GET /api/voice/numbers/:id` → the number with its price beside it (`price_currency`,
 *   `monthly_rent_usd`, `setup_price_usd`). Released numbers are 404 here.
 * - `NumberRow`: the fields the commands read.
 * - `agentLabel`: an agent's name for a question ("Support (a1b2…)"), or its id when it cannot be
 *   read.
 * - `NUMBER_VIEW`: the short view the commands print.
 * Not in here: the commands.
 * Called by: the number commands in this folder.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandContext } from '../../core/command_spec.js';

export interface NumberRow {
  id: string;
  e164: string;
  provider?: string;
  source?: string;
  agent_id?: string | null;
  is_default_outbound?: boolean;
  inbound_action?: string | null;
  is_pool?: boolean;
  monthly_rent?: string | null;
  price_currency?: string | null;
  monthly_rent_usd?: string | null;
  [k: string]: unknown;
}

export const NUMBER_VIEW = [
  'id',
  'e164',
  'provider',
  'source',
  'number_type',
  'agent_id',
  'is_default_outbound',
  'inbound_action',
  'is_pool',
  'monthly_rent',
  'price_currency',
  'monthly_rent_usd',
  'next_renewal_at',
];

export function numberPath(id: string, suffix = ''): string {
  return `/api/voice/numbers/${encodeURIComponent(id)}${suffix}`;
}

export async function readNumber(ctx: CommandContext, id: string): Promise<NumberRow> {
  const d = dataOf((await ctx.api().get(numberPath(id))).body);
  return (d && typeof d === 'object' ? d : { id, e164: id }) as NumberRow;
}

export async function agentLabel(ctx: CommandContext, agentId: string): Promise<string> {
  try {
    const a = dataOf((await ctx.api().get(`/api/agents/${encodeURIComponent(agentId)}`)).body) as { name?: unknown } | null;
    return typeof a?.name === 'string' ? `${a.name} (${agentId})` : agentId;
  } catch {
    return agentId;
  }
}
