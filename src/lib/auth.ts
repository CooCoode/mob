// Every mobd request carries the device credential of the machine that owns its base URL.
// The store installs the hooks; this module stays free of app imports so tests can run it.

export class UnauthorizedError extends Error {
  constructor() {
    super("This device needs to be paired again. Run mobd link on the office Mac and paste the new link in Settings.");
    this.name = "UnauthorizedError";
  }
}

interface AuthHooks {
  /** Credential for a mobd base URL; undefined when the machine is unpaired. */
  token: (base: string) => string | undefined;
  /** Called once per rejected request; the machine then needs pairing. */
  unauthorized: (base: string) => void;
}

let hooks: AuthHooks = { token: () => undefined, unauthorized: () => {} };

export function configureAuth(next: Partial<AuthHooks>): void {
  hooks = { ...hooks, ...next };
}

export function authHeaders(base: string, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const token = hooks.token(base.replace(/\/+$/, ""));
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export function notifyUnauthorized(base: string): void {
  hooks.unauthorized(base.replace(/\/+$/, ""));
}

/** fetch with the credential; never follows redirects, so it cannot leak to another origin. 401 throws. */
export async function authFetch(base: string, url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: authHeaders(base, init?.headers), redirect: "error" });
  if (res.status === 401) {
    notifyUnauthorized(base);
    throw new UnauthorizedError();
  }
  return res;
}

/** EventStream options for a mobd base URL: current credential on every reconnect, stop on 401. */
export function streamAuth(base: string): { headers: () => Headers; onUnauthorized: () => void } {
  return { headers: () => authHeaders(base), onUnauthorized: () => notifyUnauthorized(base) };
}
