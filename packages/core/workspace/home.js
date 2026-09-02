import { join } from "node:path";

export function dshHome(env = process.env) {
  return env.DSH_HOME?.trim() || "/data/lares/dsh-home";
}

export function dshPluginConfigPath(plugin, env = process.env) {
  return join(dshHome(env), plugin, "config.json");
}
