/**
 * open_browser.ts — open a link in the person's web browser, or say why it was not opened.
 *
 * In here:
 * - `OpenUrl`, `OpenOutcome`: the opener the command context carries (tests inject their own, so
 *   no test ever opens a real browser).
 * - `browserCommand`: the program per platform — `open <url>` on macOS,
 *   `cmd /c start "" "<url>"` on Windows, `xdg-open <url>` elsewhere.
 * - `cannotOpenReason`: no browser over SSH (it would open on the far computer), nor on Linux
 *   without a display (xdg-open would start a text browser in the background).
 * - `unsafeLinkReason`: only an http(s) link — plain http only on this computer — made of URL
 *   characters that no opener reads specially. That keeps out `file:` links and app paths
 *   (`open` would launch them) and anything cmd.exe or a shell would act on (`"`, `%`, `^`,
 *   `!`, `|`, `<`, `>`, `$`, quotes, spaces): the server's link cannot become a command.
 * - `openBrowser`: the real opener. It spawns the program with the link as ONE argument, never
 *   through a shell, detached, with no stdio; "opened" means the program started.
 * The caller always prints the link as well, so a link that is not opened is still usable.
 * Not in here: when to open (`features/auth/browser_login.ts`, `--no-browser`).
 * Called by: `main.ts` (the default opener), `features/auth/browser_login.ts` (through the
 * context), tests.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

import { isLoopbackHost } from './resolve_login.js';

export interface OpenOutcome {
  opened: boolean;
  /** Why it was not opened. */
  reason?: string;
}

export type OpenUrl = (url: string) => Promise<OpenOutcome>;

export type SpawnLike = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface BrowserCommand {
  command: string;
  args: string[];
  options: SpawnOptions;
}

/**
 * URL characters (RFC 3986) less `%` and `!` (cmd.exe expands `%NAME%` and, if enabled, `!NAME!`)
 * and less `$ ' ( ) *` (xdg-open is a shell script that hands the link on). The sign-in link is
 * `https://<host>/cli/authorize?code=WDJB-MJHT`, far inside this set.
 */
const LINK_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@&+,;=]+$/;

export function browserCommand(url: string, platform: NodeJS.Platform): BrowserCommand {
  if (platform === 'darwin') return { command: 'open', args: [url], options: {} };
  if (platform === 'win32') {
    // `start` is a cmd.exe built-in, so cmd it is. The empty title ("") stops `start` from taking
    // the quoted link as a window title; verbatim arguments keep Node from re-quoting them; the
    // link is quoted so `&` and `=` stay inside it, and `unsafeLinkReason` keeps `"` out of it.
    return {
      command: 'cmd',
      args: ['/c', 'start', '""', `"${url}"`],
      options: { windowsVerbatimArguments: true, windowsHide: true },
    };
  }
  return { command: 'xdg-open', args: [url], options: {} };
}

export function cannotOpenReason(env: Record<string, string | undefined>, platform: NodeJS.Platform): string | undefined {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) {
    return 'this is an SSH session, so a browser would open on the other computer';
  }
  if (platform !== 'darwin' && platform !== 'win32' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return 'there is no graphical display here (DISPLAY is not set)';
  }
  return undefined;
}

export function unsafeLinkReason(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'it is not a link';
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHost(u.hostname))) {
    return 'it is not an https:// link';
  }
  if (u.username || u.password) return 'it carries a user name or password';
  if (!LINK_CHARS.test(url)) return 'it holds characters a browser opener could misread';
  return undefined;
}

export function openBrowser(
  url: string,
  deps: { env: Record<string, string | undefined>; platform: NodeJS.Platform; spawn?: SpawnLike },
): Promise<OpenOutcome> {
  const reason = cannotOpenReason(deps.env, deps.platform) ?? unsafeLinkReason(url);
  if (reason) return Promise.resolve({ opened: false, reason });
  const { command, args, options } = browserCommand(url, deps.platform);
  const spawn = deps.spawn ?? (nodeSpawn as SpawnLike);
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { ...options, shell: false, detached: true, stdio: 'ignore' });
    } catch (e) {
      resolve({ opened: false, reason: `${command} could not start: ${(e as Error).message}` });
      return;
    }
    // Exactly one of these fires; without an 'error' listener a missing program would crash the CLI.
    child.once('error', (e: NodeJS.ErrnoException) => {
      resolve({ opened: false, reason: `${command} could not start: ${e.code ?? e.message}` });
    });
    child.once('spawn', () => {
      child.unref();
      resolve({ opened: true });
    });
  });
}
