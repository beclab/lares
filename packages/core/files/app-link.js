import { parseFilesPath } from "../drive/files-path.js";
import { entranceOrigin, userDomainOf } from "../olares/entrance.js";

const FILES_LABEL = "files";

function encoded(parts) {
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function filesRoute(path) {
  const [namespace, extend, ...rest] = parseFilesPath(path).split("/");
  if (namespace === "drive") {
    if (extend === "Data") return `/Data/${encoded(rest)}`;
    if (extend === "Common") return `/Common/${encoded(rest)}`;
    return `/Files/${encoded([extend, ...rest])}`;
  }
  if (namespace === "external") {
    return `/Files/External/${encoded([extend, ...rest])}`;
  }
  if (namespace === "cache") return `/Cache/${encoded([extend, ...rest])}`;
  if (["google", "dropbox", "awss3", "tencent"].includes(namespace)) {
    return `/Drive/${namespace}/${encoded([extend, ...rest])}`;
  }
  if (namespace === "sync") {
    const query = new URLSearchParams({ id: extend });
    return `/Seahub/${encoded([extend, ...rest])}?${query}`;
  }
  return "";
}

function originFromEntrance(entrance) {
  let url;
  try {
    url = new URL(String(entrance ?? ""));
  } catch {
    return "";
  }
  return entranceOrigin(FILES_LABEL, {
    domain: userDomainOf(url.hostname),
    protocol: url.protocol,
    port: url.port,
  });
}

function originFromAccount(accountDomain, protocol) {
  return entranceOrigin(FILES_LABEL, {
    domain: accountDomain,
    protocol: String(protocol ?? "https:").trim().toLowerCase(),
  });
}

export function filesAppUrl(path, options = {}) {
  let route;
  try {
    route = filesRoute(path);
  } catch {
    return "";
  }
  if (!route) return "";
  const entrance = options.entrance ?? globalThis.location?.origin ?? "";
  const origin = originFromEntrance(entrance)
    || originFromAccount(options.accountDomain, options.protocol);
  return origin ? new URL(route, origin).href : "";
}
