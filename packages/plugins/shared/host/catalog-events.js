import { connect } from "@nats-io/transport-node";

/**
 * Subscribe to Router's catalog-invalidation broadcast. Empty URL is a
 * no-op so local `npm run dev` keeps working without NATS.
 *
 * @param {() => void} onSignal
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ close: () => void } | null>}
 */
export async function watchRouterCatalog(onSignal, options = {}) {
  const env = options.env ?? process.env;
  const url = String(env.LARES_CATALOG_EVENTS_NATS_URL ?? "").trim();
  if (!url) return null;

  const user = String(env.LARES_CATALOG_EVENTS_NATS_USER ?? "").trim();
  const subject = String(env.LARES_CATALOG_EVENTS_SUBJECT ?? "").trim() || "router.catalog";
  const nc = await connect({
    servers: url,
    name: "lares-router-catalog",
    ...(user ? { user, pass: String(env.LARES_CATALOG_EVENTS_NATS_PASS ?? "") } : {}),
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2_000,
    timeout: 5_000,
  });

  const sub = nc.subscribe(subject);
  const consume = (async () => {
    for await (const _msg of sub) {
      onSignal();
    }
  })();
  consume.catch(() => {});

  return {
    close() {
      try {
        sub.unsubscribe();
      } catch {
        // Already drained.
      }
      nc.close().catch(() => {});
    },
  };
}
