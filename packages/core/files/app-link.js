import { parseFilesPath } from "../drive/files-path.js";

const OLARES_ZONES = new Set(["olares.com", "olares.local"]);
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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
  if (!["http:", "https:"].includes(url.protocol)) return "";
  const labels = url.hostname.toLowerCase().split(".");
  if (labels.length !== 4 || labels.some((label) => !DNS_LABEL.test(label))) return "";
  if (!OLARES_ZONES.has(labels.slice(-2).join("."))) return "";
  return `${url.protocol}//files.${labels.slice(1).join(".")}`;
}

function originFromAccount(accountDomain, protocol) {
  const labels = String(accountDomain ?? "").trim().toLowerCase().split(".");
  if (labels.length !== 3 || labels.some((label) => !DNS_LABEL.test(label))) return "";
  if (!OLARES_ZONES.has(labels.slice(-2).join("."))) return "";
  const scheme = String(protocol ?? "https:").trim().toLowerCase().replace(/\/?\/?$/, "");
  if (!["http:", "https:"].includes(scheme)) return "";
  return `${scheme}//files.${labels.join(".")}`;
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

/** Open Files synchronously from the click handler so popup blockers allow it. */
export function openFilesApp(path, options = {}) {
  const url = filesAppUrl(path, options);
  if (!url) return false;
  const open = options.open ?? globalThis.open;
  if (typeof open !== "function") return false;
  open(url, "_blank", "noopener,noreferrer");
  return true;
}
