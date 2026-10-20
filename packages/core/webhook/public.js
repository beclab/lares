/**
 * Public call URLs. The host is the webhook entrance, so the path is empty.
 * POST submits a prompt; GET with ?id= reads that session.
 *
 * @param {string} [origin]
 */
export function webhookCallUrls(origin) {
  const root = String(origin ?? "").replace(/\/$/, "");
  const base = root ? `${root}/` : "/";
  return { post: base, jobs: `${base}?id=` };
}
