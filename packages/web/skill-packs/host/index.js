/** Official skill-pack settings Host routes under /api/lares/skills. */
import { checkGoogleConnection, completeGoogleAuth, disconnectGoogle, importGoogleClient, startGoogleAuth } from "@olares/lares-core/skills/google";
import { createRouteHandler, HttpError, readJsonObject, sendJson } from "@olares/lares-core/tools/http";
import { connectionInput } from "@olares/lares-core/skills/connection";
import { OFFICIAL_PACKS, packById } from "@olares/lares-core/skills/packs";
import {
  defaultCatalogRoot,
  disableOfficialPack,
  enableOfficialPack,
  listOfficialPacks,
} from "@olares/lares-core/skills/state";
import { cliReadyMap, downloadPackSkills, readCliConnection, saveCliConnection } from "./cli.js";

export const name = "lares-skill-packs";
export const inject = ["webServer"];

const ROUTE_PREFIX = "/api/lares/skills";

function dataDir() {
  return process.env.LARES_DATA_DIR?.trim() || "/data/lares";
}

async function panel() {
  const packs = listOfficialPacks(dataDir(), cliReadyMap(OFFICIAL_PACKS));
  for (const pack of packs) {
    pack.connection = await readCliConnection(packById(pack.id));
  }
  return { packs };
}

function packIdFromBody(body) {
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) throw new HttpError("bad_request", 400, "id is required");
  return id;
}

/** Download installs the CLI, exports skills, and turns the pack on. */
const downloads = new Map();
export function fulfillPackDownload(pack, dir, catalogRoot, download = downloadPackSkills) {
  const key = `${dir}:${pack.id}`;
  if (downloads.has(key)) return downloads.get(key);
  const pending = (async () => {
    await download(pack, dir);
    enableOfficialPack(catalogRoot, dir, pack.id);
  })().finally(() => downloads.delete(key));
  downloads.set(key, pending);
  return pending;
}

export function routes() {
  return {
    "/": {
      GET: async (_req, res) => sendJson(res, 200, await panel()),
    },
    "/download": {
      POST: async (req, res) => {
        const pack = packById(packIdFromBody(await readJsonObject(req)));
        if (!pack) throw new HttpError("unknown_pack", 404, "unknown skill pack");
        await fulfillPackDownload(pack, dataDir(), defaultCatalogRoot());
        sendJson(res, 200, await panel());
      },
    },
    "/enable": {
      POST: async (req, res) => {
        enableOfficialPack(defaultCatalogRoot(), dataDir(), packIdFromBody(await readJsonObject(req)));
        sendJson(res, 200, await panel());
      },
    },
    "/disable": {
      POST: async (req, res) => {
        disableOfficialPack(defaultCatalogRoot(), dataDir(), packIdFromBody(await readJsonObject(req)));
        sendJson(res, 200, await panel());
      },
    },
    "/google/client": { POST: async (req, res) => {
      const body = await readJsonObject(req);
      await importGoogleClient(dataDir(), body.credentials);
      sendJson(res, 200, await panel());
    } },
    "/google/start": { POST: async (req, res) => {
      const body = await readJsonObject(req);
      const authorization = await startGoogleAuth(dataDir(), body.email);
      sendJson(res, 200, { ...await panel(), authorization });
    } },
    "/google/complete": { POST: async (req, res) => {
      const body = await readJsonObject(req);
      await completeGoogleAuth(dataDir(), body.callback);
      sendJson(res, 200, await panel());
    } },
    "/google/disconnect": { POST: async (_req, res) => {
      await disconnectGoogle(dataDir()); sendJson(res, 200, await panel());
    } },
    "/google/check": { POST: async (_req, res) => {
      await checkGoogleConnection(dataDir()); sendJson(res, 200, await panel());
    } },
    "/connection": {
      POST: async (req, res) => {
        const body = await readJsonObject(req);
        const pack = packById(packIdFromBody(body));
        if (pack?.connectionKind !== "token") throw new HttpError("unknown_pack", 404, "unknown skill pack");
        await saveCliConnection(pack, connectionInput(body));
        sendJson(res, 200, await panel());
      },
    },
  };
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: ROUTE_PREFIX,
        handler: (req, res) => {
          res.setHeader("cache-control", "no-store");
          createRouteHandler({ prefix: ROUTE_PREFIX, routes: routes(), fallbackCode: "skills_failed" })(req, res);
        },
      }),
    "lares-skill-packs-routes",
  );
}
