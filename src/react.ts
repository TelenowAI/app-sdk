// telenow/react — React hooks for building an app's dashboard UI.
//
//   import { useObjects, useTelenowContext } from 'telenow/react';
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
  type TelenowAgentPublicLink,
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
 *   import { mount } from 'telenow/react';
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
    /** Open the call's detail page (recording + transcript). Navigates away. */
    open: (sessionId: string) =>
      // Check the METHOD: `calls` predates `open`, so an older host has one
      // without the other.
      calls?.open ? calls.open(sessionId) : unavailable('calls.open'),
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
export function useAgents(): {
  agents: TelenowAgentSummary[];
  loading: boolean;
  error: Error | null;
  /** Build an agent from one of your manifest templates. `{ open: false }` skips
   *  the jump to the agent builder, which would otherwise unmount your page
   *  mid-setup. Needs an owner/admin user. */
  createFromTemplate: (
    templateId: string,
    opts?: { open?: boolean },
  ) => Promise<{ agentId: string; kind: 'single' | 'flow' }>;
  /** Build a whole team from one of your manifest team templates. */
  createTeamFromTemplate: (teamId: string) => Promise<{
    teamId: string;
    entryAgentId: string | null;
    agents: { ref: string; agentId: string | null; kind: 'single' | 'flow' }[];
  }>;
  /** Read the public slug of an agent your app owns (needs `agents:read`). */
  publicLink: (agentId: string) => Promise<TelenowAgentPublicLink>;
  /** Publish/unpublish it (needs `agents:write` + owner/admin). */
  setPublic: (agentId: string, enabled?: boolean) => Promise<TelenowAgentPublicLink>;
} {
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
  // Read the bridge per call rather than closing over it: the actions are the
  // point of the hook (setup buttons live in app pages), and `unavailable`
  // turns a host/bundle skew into a clear action error instead of a TypeError.
  return {
    agents,
    loading,
    error,
    createFromTemplate: (templateId, opts) => {
      const a = getTelenow().agents;
      return a ? a.createFromTemplate(templateId, opts) : unavailable('agents.createFromTemplate');
    },
    createTeamFromTemplate: (teamId) => {
      const a = getTelenow().agents;
      return a ? a.createTeamFromTemplate(teamId) : unavailable('agents.createTeamFromTemplate');
    },
    publicLink: (agentId) => {
      const a = getTelenow().agents;
      // `publicLink` postdates `agents` itself, so check the METHOD, not just
      // the namespace — an older host has agents.list but not this.
      return a?.publicLink ? a.publicLink(agentId) : unavailable('agents.publicLink');
    },
    setPublic: (agentId, enabled) => {
      const a = getTelenow().agents;
      return a?.setPublic ? a.setPublic(agentId, enabled) : unavailable('agents.setPublic');
    },
  };
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

  // `background` refreshes keep the current list on screen (no "Loading…"
  // flash); only the first load — and a query change — shows the spinner. This
  // stops rapid successive refreshes (e.g. seeding many rows) from flickering
  // the whole page back to a loading state.
  const fetchList = useCallback(
    (background = false) => {
      if (!background) setLoading(true);
      return getTelenow()
        .data.list<T>(objectType, query)
        .then((rows) => {
          setData(rows);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
        .finally(() => setLoading(false));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [objectType, queryKey],
  );

  useEffect(() => {
    void fetchList(false);
  }, [fetchList]);

  // Public reload = a BACKGROUND refresh (list stays visible while it re-syncs).
  const reload = useCallback(() => {
    void fetchList(true);
  }, [fetchList]);

  // Writes update the local list OPTIMISTICALLY from the record the server
  // returns — no full re-fetch — so creating/updating/removing many rows in a
  // row (demo seeding, bulk edits) is instant and never flickers the page. The
  // returned record IS the persisted server row, so local state stays accurate.
  const create = useCallback(
    async (body: Partial<T>) => {
      const r = await getTelenow().data.create<T>(objectType, body);
      setData((cur) => [...cur, r]);
      return r;
    },
    [objectType],
  );

  const update = useCallback(
    async (id: string, body: Partial<T>) => {
      const r = await getTelenow().data.update<T>(objectType, id, body);
      setData((cur) => cur.map((x) => (x.id === id ? r : x)));
      return r;
    },
    [objectType],
  );

  const remove = useCallback(
    async (id: string) => {
      await getTelenow().data.remove(objectType, id);
      setData((cur) => cur.filter((x) => x.id !== id));
    },
    [objectType],
  );

  return { data, loading, error, reload, create, update, remove };
}
