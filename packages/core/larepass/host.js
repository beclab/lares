export const APP_ID = "lares";
export const LARES_API_PREFIX = "/api/lares";
export const MODELS_PATH = `${LARES_API_PREFIX}/models`;
export const PC_TEST_PROXY = "/laresHost";

/** Host plugin routes (`file-preview`, models, voice, …). Same path on PC and LarePass. */
export function isLaresPluginPath(path) {
  const suffix = String(path ?? "").startsWith("/") ? path : `/${path}`;
  return suffix === LARES_API_PREFIX
    || suffix.startsWith(`${LARES_API_PREFIX}/`)
    || suffix.startsWith(`${LARES_API_PREFIX}?`);
}

export function originOf(url) {
  if (!url) return "";
  try {
    return new URL(String(url)).origin;
  } catch {
    return "";
  }
}

export function findLaresEntrance(apps) {
  const list = Array.isArray(apps) ? apps : [];
  const hit = list.find((app) => app?.appid === APP_ID || app?.id === APP_ID);
  return originOf(hit?.url);
}

export function entranceFromDomain({ protocol = "https:", subdomain, accountDomain }) {
  const host = String(subdomain ?? "").trim();
  const domain = String(accountDomain ?? "").trim();
  if (!host || !domain) return "";
  const scheme = String(protocol).replace(/:\/?\/?$/, "");
  return `${scheme}://${host}.${domain}`;
}

export function hostConfigFromEnv(env = {}) {
  return {
    baseUrl: entranceFromDomain({
      protocol: env.PROTOCOL,
      subdomain: env.LARES_SUB_DOMAIN,
      accountDomain: env.ACCOUNT_DOMAIN,
    }),
    proxyPrefix: env.IS_PC_TEST ? PC_TEST_PROXY : "",
  };
}

/** Resolve the live Host origin. Explicit baseUrl/proxyPrefix win over env. */
export function hostTarget(ports = {}) {
  const fromEnv = hostConfigFromEnv(ports.env);
  return {
    baseUrl: ports.baseUrl ?? fromEnv.baseUrl,
    proxyPrefix: ports.proxyPrefix ?? fromEnv.proxyPrefix,
  };
}

export function hostKey(ports = {}) {
  const { baseUrl, proxyPrefix } = hostTarget(ports);
  return hostUrl({ baseUrl, proxyPrefix, path: "/api" });
}

/**
 * LarePass → Host ports. PC preview keeps the webpack env + /laresHost proxy.
 * A logged-in account uses the current myApps entrance, never a baked subdomain.
 */
export function laresPortsFromAccount({ env, apps } = {}) {
  const fromEnv = hostConfigFromEnv(env);
  if (fromEnv.proxyPrefix) {
    return { env, proxyPrefix: fromEnv.proxyPrefix, baseUrl: undefined };
  }
  const baseUrl = findLaresEntrance(apps);
  return { baseUrl: baseUrl || undefined, env: undefined, proxyPrefix: undefined };
}

export function hostUrl({ baseUrl = "", proxyPrefix = "", path }) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (proxyPrefix) {
    // Plugin routes are same-origin Host URLs. Prefixing them with /laresHost
    // would make the same conversation emit different img/src on LarePass vs PC.
    // RPC (`/api/session.list`) still needs the proxy: `/api` is Files.
    if (isLaresPluginPath(suffix)) return suffix;
    return `${proxyPrefix.replace(/\/$/, "")}${suffix}`;
  }
  const origin = String(baseUrl).replace(/\/$/, "");
  return origin ? `${origin}${suffix}` : suffix;
}

export function isAuthFailure(http) {
  return http === 401 || http === 403 || http === 301 || http === 302 || http === 303 || http === 307 || http === 308;
}

export async function probeHost(request, path = MODELS_PATH) {
  try {
    const res = await request(path);
    const http = Number(res?.status) || 0;
    if (isAuthFailure(http)) {
      return { status: "unauthorized", http };
    }
    if (http >= 200 && http < 300) return { status: "ok", http, body: res.body };
    return { status: "error", http };
  } catch (err) {
    return {
      status: "unreachable",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
