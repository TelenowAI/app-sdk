/**
 * api_client.ts — the one HTTP client every account command uses.
 *
 * In here: `ApiClient` (sends a request with the org API key, parses the JSON answer, turns a
 * non-2xx answer into a `CliError`, retries READS on 429 / 502 / 503 / 504 / network errors),
 * `dataOf` (unwraps the platform's `{ success, data }` envelope) and `FetchLike`.
 * - An empty `apiKey` sends no `X-API-Key` at all: the browser login's two routes
 *   (`/api/cli-login/start`, `/token`) take no key.
 * - A request may carry a `signal` (Ctrl-C during the browser login): when it fires, the request
 *   is dropped and the error is `cancelled`, not a timeout.
 * - A 401 to a saved key whose expiry has passed says "this login expired on …"
 *   (`login_expiry.ts`).
 * - `openStream` is a GET whose body the caller streams to a file (an export, a recording).
 * Not in here: where the key and the base URL come from (`resolve_login.ts`), printing
 * (`print_output.ts`). Writes are never retried here: a retried write could save twice.
 * Called by: `main.ts` (builds it), every command (through the command context).
 */

import { CliError, EXIT, exitCodeForStatus } from './cli_error.js';
import { expiredLoginError, type LoginExpiry } from './login_expiry.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientConfig {
  baseUrl: string;
  /** Sent as `X-API-Key`; empty for the routes that take no key. */
  apiKey: string;
  userAgent: string;
  timeoutMs: number;
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  /** The saved key's expiry, so a 401 after it says "this login expired". */
  expiry?: LoginExpiry;
}

export type QueryValue = string | number | boolean | undefined;

export interface ApiRequest {
  query?: Record<string, QueryValue>;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as multipart/form-data instead of `body` (file uploads); fetch sets the boundary. */
  form?: FormData;
  headers?: Record<string, string>;
  /** Drops the request when it fires (Ctrl-C); the error is then `cancelled`. */
  signal?: AbortSignal;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

/**
 * How many times a READ is tried again after the first attempt. Two retries ride out a deploy
 * restart or a brief overload without making a broken server look slow for long.
 */
const READ_RETRIES = 2;
/** First wait before a retry; each later wait is `BACKOFF_FACTOR` times longer. */
const FIRST_BACKOFF_MS = 500;
const BACKOFF_FACTOR = 3;
/**
 * The longest `Retry-After` the CLI waits out inside one command. The per-key window is 15
 * minutes; sitting silent for longer than a minute is worse than telling the caller when to
 * come back.
 */
const MAX_RETRY_AFTER_MS = 60_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export function dataOf(body: unknown): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (b.success === true && 'data' in b) return b.data;
  }
  return body;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly cfg: ApiClientConfig;

  constructor(cfg: ApiClientConfig) {
    this.cfg = cfg;
    this.baseUrl = cfg.baseUrl;
  }

  /** How long one request may wait for its answer to start. */
  get timeoutMs(): number {
    return this.cfg.timeoutMs;
  }

  url(path: string, query?: Record<string, QueryValue>): string {
    const u = new URL(this.cfg.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  /** A GET, retried on the answers `RETRYABLE_STATUS` lists and on network errors. */
  async get(path: string, req: ApiRequest = {}): Promise<ApiResponse> {
    const url = this.url(path, req.query);
    for (let attempt = 0; ; attempt++) {
      let res: ApiResponse;
      try {
        res = await this.once('GET', url, req);
      } catch (e) {
        if (e instanceof CliError && e.exitCode === EXIT.network && attempt < READ_RETRIES) {
          await this.cfg.sleep(backoffMs(attempt));
          continue;
        }
        throw e;
      }
      if (res.status < 400) return res;
      if (RETRYABLE_STATUS.has(res.status) && attempt < READ_RETRIES) {
        const wait = retryAfterMs(res.headers.get('retry-after')) ?? backoffMs(attempt);
        if (wait <= MAX_RETRY_AFTER_MS) {
          await this.cfg.sleep(wait);
          continue;
        }
      }
      throw this.fail(res);
    }
  }

  /**
   * A GET whose body the caller reads as a stream: a CSV export, a recording. It is retried like
   * `get` until an answer arrives. The time limit covers only the wait for the answer to start,
   * so a large download is never cut off part-way; the caller watches for a body that stalls
   * (`download_file.ts`) and calls `abort` to drop it. A non-2xx answer is read whole and
   * becomes a `CliError`, as in `get`.
   */
  async openStream(path: string, req: ApiRequest = {}): Promise<OpenedStream> {
    const url = this.url(path, req.query);
    for (let attempt = 0; ; attempt++) {
      let opened: OpenedStream;
      try {
        opened = await this.openOnce(url, req);
      } catch (e) {
        if (e instanceof CliError && e.exitCode === EXIT.network && attempt < READ_RETRIES) {
          await this.cfg.sleep(backoffMs(attempt));
          continue;
        }
        throw e;
      }
      const r = opened.response;
      if (r.status < 400) return opened;
      const res: ApiResponse = { status: r.status, body: parseBody(await r.text()), headers: r.headers };
      if (RETRYABLE_STATUS.has(res.status) && attempt < READ_RETRIES) {
        const wait = retryAfterMs(res.headers.get('retry-after')) ?? backoffMs(attempt);
        if (wait <= MAX_RETRY_AFTER_MS) {
          await this.cfg.sleep(wait);
          continue;
        }
      }
      throw this.fail(res);
    }
  }

  /** A write. Sent once: the caller decides what a failure means. */
  async send(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, req: ApiRequest = {}): Promise<ApiResponse> {
    const res = await this.once(method, this.url(path, req.query), req);
    if (res.status < 400) return res;
    throw this.fail(res);
  }

  private fail(res: ApiResponse): CliError {
    const e = toCliError(res);
    return expiredLoginError(e, this.cfg.expiry, Date.now()) ?? e;
  }

  private async once(method: string, url: string, req: ApiRequest): Promise<ApiResponse> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.cfg.userAgent,
      ...(this.cfg.apiKey ? { 'X-API-Key': this.cfg.apiKey } : {}),
      ...req.headers,
    };
    let body: string | FormData | undefined;
    if (req.form !== undefined) {
      body = req.form;
    } else if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }
    const origin = new URL(url).origin;
    const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
    let r: Response;
    try {
      r = await this.cfg.fetch(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        // AbortSignal.any is Node 20.3+; on an older 20.x a cancel waits for the request to end.
        signal: req.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, req.signal]) : timeout,
      });
    } catch (e) {
      const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
      if (req.signal?.aborted) throw new CliError('cancelled', EXIT.usage, { code: 'cancelled' });
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new CliError(`no answer from ${origin} within ${this.cfg.timeoutMs} ms`, EXIT.network);
      }
      const why = err.cause?.code ?? err.cause?.message ?? err.message ?? 'unknown error';
      throw new CliError(`could not reach ${origin}: ${why}`, EXIT.network);
    }
    // A redirect is refused rather than followed: following it would send the API key to
    // wherever the Location header points.
    if (r.status >= 300 && r.status < 400) {
      throw new CliError(
        `${origin} answered with a redirect (${r.status}) to ${r.headers.get('location') ?? 'nowhere'}; ` +
          'check the base URL (`--base-url` / TELENOW_BASE_URL)',
        EXIT.usage,
        { status: r.status },
      );
    }
    const text = await r.text();
    return { status: r.status, body: parseBody(text), headers: r.headers };
  }

  /** `once` for `openStream`: a GET whose answer is returned before its body is read. */
  private async openOnce(url: string, req: ApiRequest): Promise<OpenedStream> {
    const headers: Record<string, string> = {
      Accept: '*/*',
      'User-Agent': this.cfg.userAgent,
      ...(this.cfg.apiKey ? { 'X-API-Key': this.cfg.apiKey } : {}),
      ...req.headers,
    };
    const origin = new URL(url).origin;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.cfg.timeoutMs);
    let r: Response;
    try {
      r = await this.cfg.fetch(url, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal:
          req.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([controller.signal, req.signal]) : controller.signal,
      });
    } catch (e) {
      const err = e as { message?: string; cause?: { code?: string; message?: string } };
      if (req.signal?.aborted) throw new CliError('cancelled', EXIT.usage, { code: 'cancelled' });
      if (timedOut) throw new CliError(`no answer from ${origin} within ${this.cfg.timeoutMs} ms`, EXIT.network);
      const why = err.cause?.code ?? err.cause?.message ?? err.message ?? 'unknown error';
      throw new CliError(`could not reach ${origin}: ${why}`, EXIT.network);
    } finally {
      clearTimeout(timer);
    }
    // Refused, never followed, for the same reason as in `once`: the key would go along.
    if (r.status >= 300 && r.status < 400) {
      await r.body?.cancel().catch(() => undefined);
      throw new CliError(
        `${origin} answered with a redirect (${r.status}) to ${r.headers.get('location') ?? 'nowhere'}; ` +
          'check the base URL (`--base-url` / TELENOW_BASE_URL)',
        EXIT.usage,
        { status: r.status },
      );
    }
    return { response: r, abort: () => controller.abort() };
  }
}

/** A streamed answer (`ApiClient.openStream`); `abort` drops the rest of its body. */
export interface OpenedStream {
  response: Response;
  abort: () => void;
}

/** An answer's text as JSON when it is JSON, else the text; `null` when empty. */
function parseBody(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function backoffMs(attempt: number): number {
  return FIRST_BACKOFF_MS * Math.pow(BACKOFF_FACTOR, attempt);
}

/** `Retry-After` as seconds or as an HTTP date; `undefined` when absent or unreadable. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header.trim());
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return undefined;
}

export function toCliError(res: ApiResponse): CliError {
  const b = res.body;
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  let details: Record<string, unknown> | undefined;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    const o = b as Record<string, unknown>;
    if (typeof o.error === 'string') message = o.error;
    else if (typeof o.message === 'string') message = o.message;
    if (typeof o.code === 'string') code = o.code;
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (!['success', 'error', 'message', 'code'].includes(k)) rest[k] = v;
    }
    if (Object.keys(rest).length > 0) details = rest;
  } else if (typeof b === 'string' && b.trim().length > 0) {
    message = `HTTP ${res.status}: ${b.trim()}`;
  }
  const retryAfter = res.headers.get('retry-after');
  if (res.status === 429 && retryAfter) details = { ...details, retryAfter };
  return new CliError(message, exitCodeForStatus(res.status), { status: res.status, code, details });
}
