/** Official optional skill packs. Always-on prefixes are seeded every boot from the image catalog. */

export const ALWAYS_ON_PREFIXES = ["olares-", "lares-"];

export const OFFICIAL_PACKS = [
  {
    id: "ha",
    prefix: "ha-",
    optional: true,
    cli: {
      package: "@olares/hass-cli",
      version: "0.0.1",
      bin: "hass-cli",
      listArgs: ["skill", "list"],
      showArgs: (name) => ["skill", "show", name],
    },
  },
];

export function packById(id) {
  return OFFICIAL_PACKS.find((pack) => pack.id === id) ?? null;
}

export function packForSkillDir(name) {
  return OFFICIAL_PACKS.find((pack) => name.startsWith(pack.prefix)) ?? null;
}

export function isAlwaysOnSkillDir(name) {
  return ALWAYS_ON_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** First column of `hass-cli skill list` (name, then tab/spaces, then description). */
export function parseSkillNames(listOutput) {
  return String(listOutput ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\t ]+/, 1)[0])
    .filter((name) => name && !name.startsWith("NAME"));
}
