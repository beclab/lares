/** Official skill-pack settings Host routes under /api/lares/skills. */
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
export async function fulfillPackDownload(pack, dir, catalogRoot, download = downloadPackSkills) {
  await download(pack, dir);
  enableOfficialPack(catalogRoot, dir, pack.id);
}

function routes() {
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
    "/connection": {
      POST: async (req, res) => {
        const body = await readJsonObject(req);
        const pack = packById(packIdFromBody(body));
        if (!pack?.cli) throw new HttpError("unknown_pack", 404, "unknown skill pack");
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
        handler: createRouteHandler({
          prefix: ROUTE_PREFIX,
          routes: routes(),
          fallbackCode: "skills_failed",
        }),
      }),
    "lares-skill-packs-routes",
  );
}
