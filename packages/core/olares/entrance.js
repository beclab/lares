/**
 * Olares 入口域推导（client 侧共享源码，由各插件 client 构建时内联）。
 *
 * Olares 给每个应用入口分配 `<前缀>.<用户>.<zone>`：Lares 的前缀随安装随机，
 * Router chart 固定申领第三级域名 `router`，两者共用同一 zone
 * （公网 olares.com 与局域网 olares.local 各一套）。因此把当前页面域名的
 * 首段换成 `router` 即 Router 控制台。
 *
 * 端口转发 / IP 直连等非入口访问下无法推断，返回空串，调用方应隐藏入口。
 */

export function loopbackWebUrl(port) {
  if (port === undefined || port === null || port === "") {
    throw new Error("webServer missing while resolving surface URL");
  }
  return `http://127.0.0.1:${String(port)}`;
}

const ROUTER_LABEL = "router";
const OLARES_ZONES = new Set(["olares.com", "olares.local"]);
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Router 控制台是 history 模式 SPA，入口即顶层路由路径。
const ROUTER_ROUTE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/**
 * @param {string} [route] Router 控制台顶层路由，如 llm / audio / tools
 * @param {string} [hostname] 当前页面 hostname（不含端口）
 * @returns {string} Router 控制台 URL；无法推断时为空串
 */
export function routerConsoleUrl(route = "", hostname = globalThis.location?.hostname ?? "") {
  const labels = String(hostname).trim().toLowerCase().split(".");
  if (labels.length !== 4 || labels.some((label) => !DNS_LABEL.test(label))) return "";
  if (!OLARES_ZONES.has(labels.slice(-2).join("."))) return "";
  const path = String(route).trim().toLowerCase();
  if (path && !ROUTER_ROUTE.test(path)) return "";
  const origin = `https://${[ROUTER_LABEL, ...labels.slice(1)].join(".")}`;
  return path ? `${origin}/${path}` : origin;
}

/** 新标签页打开 Router 控制台；无入口时静默忽略。 */
export function openRouterConsole(route = "") {
  const url = routerConsoleUrl(route);
  if (!url) return;
  globalThis.open?.(url, "_blank", "noopener,noreferrer");
}
