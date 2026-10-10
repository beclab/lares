/** Client diagnostics. One record shape, whether it is written here or posted in. */

export const REPORT_PATH = "/api/lares/log";

const SCOPE = /^[a-z][a-z0-9-]{0,31}$/;
const EVENT = /^[a-z][a-z0-9-]{0,39}$/;
const FIELD = /^[a-z][a-zA-Z0-9]{0,31}$/;

export function reportRecord(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const scope = typeof source.scope === "string" && SCOPE.test(source.scope) ? source.scope : "client";
  const event = typeof source.event === "string" && EVENT.test(source.event) ? source.event : "event";
  const record = { scope, event };
  for (const [key, value] of Object.entries(source)) {
    if (key === "scope" || key === "event" || !FIELD.test(key)) continue;
    if (typeof value === "string") record[key] = value.slice(0, 180);
    else if (typeof value === "number" && Number.isFinite(value)) record[key] = value;
    else if (typeof value === "boolean") record[key] = value;
  }
  return record;
}

export function writeReport(input) {
  const record = reportRecord(input);
  console.log(`[lares:${record.scope}]`, JSON.stringify(record));
  return record;
}

/**
 * Fire-and-forget. `request` is the host port when the page has no cookie.
 * A rejected port does not reject the caller.
 */
export function postReport(input, options = {}) {
  const body = reportRecord(input);
  const url = options.url ?? REPORT_PATH;
  const send = options.request;
  const pending = typeof send === "function"
    ? send(url, { method: "POST", headers: { "content-type": "application/json" }, body })
    : fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return Promise.resolve(pending).then(() => true, () => false);
}
