/**
 * request_keys.ts — catch snake_case keys in an agent body before the server ignores them.
 *
 * In here: `snakeCaseNotes`. Agent REQUESTS are camelCase (`systemPrompt`, `ttsVoice`) while
 * agent RESPONSES are snake_case (`system_prompt`, `tts_voice`), and the server ignores
 * unknown keys — so a body copied from `telenow agents get` saves nothing for those fields,
 * silently. This lists such top-level keys (and their camelCase form) as a note on stderr.
 * `metadata`'s own keys are camelCase too (`flowDraft`, …) but free-form, so they are not judged.
 * Not in here: sending (`create_agent.ts`, `update_agent.ts`).
 * Called by: `create_agent.ts`, `update_agent.ts`.
 */

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function snakeCaseNotes(body: Record<string, unknown>): unknown[] {
  const snake = Object.keys(body).filter((k) => /_[a-z0-9]/.test(k));
  if (snake.length === 0) return [];
  return [
    {
      warning:
        'agent requests are camelCase; these keys are ignored by the server: ' +
        snake.map((k) => `${k} (send ${camel(k)})`).join(', '),
    },
  ];
}
