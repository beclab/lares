export const APP_ID = "lares";
export const MODELS_PATH = "/api/lares/models";
export const PC_TEST_PROXY = "/laresHost";

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

export function hostUrl({ baseUrl = "", proxyPrefix = "", path }) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (proxyPrefix) return `${proxyPrefix.replace(/\/$/, "")}${suffix}`;
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
