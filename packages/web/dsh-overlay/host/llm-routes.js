/**
 * Readiness probe + LLM gateway shim at /llm/v1 (chat + voice STT).
 */
import { sendJson } from "@lares/core/tools/http";
import { healthPayload, proxyToRouter, SHIM_PATH } from "@lares/core/router/shim";

export const name = "lares-llm-routes";
export const inject = ["webServer"];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/api/health",
        handler: (_req, res) => sendJson(res, 200, healthPayload()),
      }),
    "lares-health",
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: SHIM_PATH,
        handler: proxyToRouter,
      }),
    "lares-llm-proxy",
  );
}
