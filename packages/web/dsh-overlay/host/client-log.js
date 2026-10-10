import { createRouteHandler, readJsonObject, sendJson } from "@olares/lares-core/tools/http";
import { REPORT_PATH, writeReport } from "@olares/lares-core/log/report";

export const name = "lares-client-log";
export const inject = ["webServer"];

async function handleReport(req, res) {
  writeReport(await readJsonObject(req));
  sendJson(res, 200, { ok: true });
}

const handler = createRouteHandler({
  prefix: REPORT_PATH,
  routes: {
    "/": { POST: handleReport },
  },
  fallbackCode: "bad_request",
});

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: REPORT_PATH, handler }),
    "lares-client-log-routes",
  );
}
