// @telenow/app/react — React hooks for building an app's dashboard UI.
//
//   import { useObjects, useTelenowContext } from '@telenow/app/react';
//
//   export default function App() {
//     const { page } = useTelenowContext();
//     const { data, loading, create } = useObjects('appointment');
//     if (loading) return <p>Loading…</p>;
//     return <Calendar events={data} onBook={(a) => create(a)} />;
//   }
//
// `react` is a peer dependency — your app already bundles it.

import { createElement, useCallback, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import {
  getTelenow,
  type AppRecord,
  type CallRecord,
  type TelenowAgentSummary,
  type TelenowContext,
  type TelenowHttpRequest,
  type TelenowSettings,
  type TelenowUser,
} from './browser';

/**
 * Mount your root component into the dashboard's iframe. The runtime host
 * provides a `#root` element. Your bundle entry is then a one-liner:
 *
 *   import { mount } from '@telenow/app/react';
 *   import App from './App';
 *   mount(App);
 */
export function mount(App: ComponentType): void {
  const el = document.getElementById('root');
  if (!el) throw new Error('Telenow runtime: #root element not found');
  createRoot(el).render(createElement(App));
}

/** The active page/app context the dashboard handed your UI. */
export function useTelenowContext(): TelenowContext {
  return getTelenow().context;
}

/** The signed-in user + a `can(permission)` helper, for RBAC in your UI.
 *  (Hard enforcement is always server-side; this only gates what you render.) */
export function useUser(): { user: TelenowUser | null; can: (permission: string) => boolean } {
  const user = getTelenow().user;
  const can = useCallback(
    (permission: string) => !!user && user.permissions.includes(permission),
    [user],
  );
  return { user, can };
}

/** Non-secret per-install config (admin-configured in the dashboard). Synchronous
 *  — the values are injected at load. Secrets are NEVER here. Degrades to an
 *  empty reader on an older host that predates settings. */
export function useSettings(): TelenowSettings {
  const t = getTelenow();
  return t.settings ?? { all: () => ({}), get: () => undefined };
}

/** A capability the running dashboard doesn't expose (an older host, or a newer
 *  bundle). Returns a rejected promise with a clear message instead of a cryptic
 *  TypeError — so a feature gap surfaces as an action error, never a blank UI. */
function unavailable(cap: string): Promise<never> {
  return Promise.reject(
    new Error(`Telenow: "${cap}" is unavailable — update the dashboard to use it.`),
  );
}

/** Place outbound voice calls + read call history. Requires the `calls:*` scopes. */
export function useCall() {
  const calls = getTelenow().calls;
  return {
    initiate: (agentId: string, phone: string) =>
      calls ? calls.initiate(agentId, phone) : unavailable('calls.initiate'),
    history: (filters?: Record<string, string>) =>
      calls ? calls.history(filters) : unavailable('calls.history'),
  };
}

/** Send WhatsApp messages + list channels. Requires the `whatsapp:send` scope. */
export function useWhatsapp() {
  const wa = getTelenow().whatsapp;
  return {
    channels: () => (wa ? wa.channels() : unavailable('whatsapp.channels')),
    send: (channelId: string, to: string, message: string) =>
      wa ? wa.send(channelId, to, message) : unavailable('whatsapp.send'),
  };
}

/** Open the dashboard softphone prefilled, for the user to dial. Requires `softphone:dial`. */
export function useSoftphone() {
  const sp = getTelenow().softphone;
  return { dial: (phone: string) => (sp ? sp.dial(phone) : unavailable('softphone.dial')) };
}

/** Mint a short-lived JWT your app's backend can verify. Requires `session:token`. */
export function useSession() {
  const session = getTelenow().session;
  return { token: () => (session ? session.token() : unavailable('session.token')) };
}

/** Call a third-party API through the server-side proxy. The host must be in
 *  your declared `http:<host>` scopes. Returns `{ status, headers, body }`. */
export function useHttp() {
  const http = getTelenow().http;
  return { fetch: (request: TelenowHttpRequest) => (http ? http(request) : unavailable('http')) };
}

/** The org's agents (id + name), loaded on mount. Requires `agents:read`. */
export function useAgents(): { agents: TelenowAgentSummary[]; loading: boolean; error: Error | null } {
  const [agents, setAgents] = useState<TelenowAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    const t = getTelenow();
    // Degrade gracefully if the host predates this capability (or the scope
    // wasn't granted) — return empty instead of throwing, so the app never
    // blank-screens on a host/bundle version skew.
    if (!t.agents) {
      setLoading(false);
      return;
    }
    t.agents
      .list()
      .then((a) => {
        setAgents(a);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setLoading(false));
  }, []);
  return { agents, loading, error };
}

/** The org's call history with optional filters; `reload` to refresh. Requires `calls:read`. */
export function useCallHistory(filters?: Record<string, string>): {
  calls: CallRecord[];
  loading: boolean;
  error: Error | null;
  reload: () => void;
} {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const key = JSON.stringify(filters ?? {});
  const reload = useCallback(() => {
    setLoading(true);
    const t = getTelenow();
    // Degrade gracefully on an older host (no call-history capability).
    if (!t.calls) {
      setCalls([]);
      setLoading(false);
      return;
    }
    t.calls
      .history(filters)
      .then((c) => {
        setCalls(c);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { calls, loading, error, reload };
}

export interface UseObjectsResult<T> {
  data: AppRecord<T>[];
  loading: boolean;
  error: Error | null;
  reload: () => void;
  create: (body: Partial<T>) => Promise<AppRecord<T>>;
  update: (id: string, body: Partial<T>) => Promise<AppRecord<T>>;
  remove: (id: string) => Promise<void>;
}

/**
 * Live list of one of your app's object types, with create/update/remove that
 * refresh it. All calls go through the dashboard bridge (scoped to your app in
 * the current org). `query` filters by stored field equality.
 */
export function useObjects<T = Record<string, unknown>>(
  objectType: string,
  query?: Record<string, string>,
): UseObjectsResult<T> {
  const [data, setData] = useState<AppRecord<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const queryKey = JSON.stringify(query ?? {});

  const reload = useCallback(() => {
    setLoading(true);
    getTelenow()
      .data.list<T>(objectType, query)
      .then((rows) => {
        setData(rows);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType, queryKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (body: Partial<T>) => {
      const r = await getTelenow().data.create<T>(objectType, body);
      reload();
      return r;
    },
    [objectType, reload],
  );

  const update = useCallback(
    async (id: string, body: Partial<T>) => {
      const r = await getTelenow().data.update<T>(objectType, id, body);
      reload();
      return r;
    },
    [objectType, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await getTelenow().data.remove(objectType, id);
      reload();
    },
    [objectType, reload],
  );

  return { data, loading, error, reload, create, update, remove };
}
