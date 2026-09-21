/**
 * Router 控制台入口只有 Host 知道：chart 把 `router.<user.zone>` 渲染进
 * `LLM_GATEWAY_URL`，而页面域名推不出它——局域网 zone 根本没有这条 DNS 记录。
 * 注进 <head>，设置页的「Router console」按钮直接读，无入口时按钮自己隐藏。
 */
import { ROUTER_CONSOLE_GLOBAL, routerConsoleOrigin } from "@olares/lares-core/olares/entrance";
import { injectHeadScript } from "@olares/lares-core/tools/head-script";

export const name = "lares-router-console";
export const inject = ["webServer"];

export function injectRouterConsole(html, gatewayUrl) {
  const origin = routerConsoleOrigin(gatewayUrl);
  if (!origin) return html;
  return injectHeadScript(html, {
    marker: "data-lares-router-console",
    code: `globalThis.${ROUTER_CONSOLE_GLOBAL}=${JSON.stringify(origin)};`,
  });
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.tapIndex((html) => injectRouterConsole(html, process.env.LLM_GATEWAY_URL)),
    "lares-router-console",
  );
}
