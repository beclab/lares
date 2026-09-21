/**
 * Olares 入口域推导（client 侧共享源码，由各插件 client 构建时内联）。
 *
 * Olares 给每个应用入口分配 `<第三级域名>.<用户域>`。用户域由 Olares ID 决定
 * （olares.com、大陆的 olares.cn、局域网 olares.local，或自定义域名），zone 不可
 * 枚举，只能从当前入口地址里取；scheme 同理——局域网入口未必是 https。
 *
 * 端口转发 / IP 直连等非入口访问下无法推断，返回空串，调用方应隐藏入口。
 */

export function loopbackWebUrl(port) {
  if (port === undefined || port === null || port === "") {
    throw new Error("webServer missing while resolving surface URL");
  }
  return `http://127.0.0.1:${String(port)}`;
}

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Router 控制台是 history 模式 SPA，入口即顶层路由路径。
const ROUTER_ROUTE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

// 用户域是 `<用户名>.<zone>`，zone 本身至少两段，所以不足三段的不是用户域；
// 末段全是数字则是 IP 字面量。
function userDomainLabels(domain) {
  const labels = String(domain ?? "").trim().toLowerCase().split(".");
  if (labels.length < 3 || !/[a-z]/.test(labels[labels.length - 1])) return [];
  return labels.every((label) => DNS_LABEL.test(label)) ? labels : [];
}

/**
 * 入口 hostname 去掉应用自己的第三级域名，剩下的就是用户域。
 * @param {string} hostname 入口 hostname（不含端口）
 * @returns {string} `<用户名>.<zone>`；非入口访问时为空串
 */
export function userDomainOf(hostname) {
  const labels = String(hostname ?? "").trim().toLowerCase().split(".");
  if (!DNS_LABEL.test(labels[0] ?? "")) return "";
  return userDomainLabels(labels.slice(1).join(".")).join(".");
}

/**
 * @param {string} label 应用的第三级域名，如 files
 * @param {{domain?: string, protocol?: string, port?: string}} entrance
 * @returns {string} 同一入口区下该应用的 origin；无法推断时为空串
 */
export function entranceOrigin(label, { domain, protocol = "https:", port = "" } = {}) {
  const scheme = String(protocol ?? "").trim().toLowerCase();
  if (!["http:", "https:"].includes(scheme)) return "";
  if (!DNS_LABEL.test(String(label ?? ""))) return "";
  // 入口永远在 scheme 默认端口上，带端口的是转发或本地调试，不是入口。
  if (String(port ?? "")) return "";
  const labels = userDomainLabels(domain);
  return labels.length ? `${scheme}//${label}.${labels.join(".")}` : "";
}

export const ROUTER_CONSOLE_GLOBAL = "__LARES_ROUTER_CONSOLE__";

/**
 * Router 控制台的入口不能靠当前页面域名推：它是 Router chart 申领的第三级域名
 * `router.<用户域>`，只登记在公网 zone，局域网 DNS 里没有这条记录（同一入口在
 * 节点 ingress 上是通的，但 `router.<用户>.olares.local` 解析不出来）。权威来源
 * 只有 Host 侧的 `LLM_GATEWAY_URL`——chart 用 `.Values.user.zone` 渲染，天然跟着
 * 用户的 .com / .cn / 自定义域名走。
 *
 * @param {string} [gatewayUrl] Router 数据面 URL，或已解析出的控制台 origin
 * @returns {string} 控制台 origin；集群外（如本地 `router-svc.router-shared`）为空串
 */
export function routerConsoleOrigin(gatewayUrl) {
  let url;
  try {
    url = new URL(String(gatewayUrl ?? ""));
  } catch {
    return "";
  }
  const [label, ...domain] = url.hostname.toLowerCase().split(".");
  return entranceOrigin(label, { domain: domain.join("."), protocol: url.protocol, port: url.port });
}

/**
 * @param {string} route Router 控制台顶层路由，如 llm / audio / tools
 * @param {string} [origin] Host 注入的控制台 origin
 * @returns {string} Router 控制台 URL；无入口时为空串
 */
export function routerConsoleUrl(route = "", origin = globalThis[ROUTER_CONSOLE_GLOBAL]) {
  const base = routerConsoleOrigin(origin);
  if (!base) return "";
  const path = String(route).trim().toLowerCase();
  if (path && !ROUTER_ROUTE.test(path)) return "";
  return path ? `${base}/${path}` : base;
}

/** 新标签页打开 Router 控制台；无入口时静默忽略。 */
export function openRouterConsole(route = "") {
  const url = routerConsoleUrl(route);
  if (!url) return;
  globalThis.open?.(url, "_blank", "noopener,noreferrer");
}
