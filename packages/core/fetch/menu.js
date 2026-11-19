export const FETCH_ROUTER_DEFAULT = "router-default";
export const FETCH_OFF = "off";

/** @param {{ defaultFetchModel?: string | null, fetchOff?: boolean } | null} [config] */
export function fetchMenuValue(config) {
  if (config?.fetchOff) return FETCH_OFF;
  return config?.defaultFetchModel ?? FETCH_ROUTER_DEFAULT;
}

/** @param {string} id */
export function fetchValueFromMenu(id) {
  if (id === FETCH_OFF) return { defaultFetchModel: null, fetchOff: true };
  if (id === FETCH_ROUTER_DEFAULT) return { defaultFetchModel: null, fetchOff: false };
  return { defaultFetchModel: id, fetchOff: false };
}

export function fetchDefaultReady(models, config) {
  return fetchStatus(models, config).ready;
}

/**
 * What the settings panel says about web fetch, decided once for every
 * surface. Following Router is ready as soon as Router serves any fetch
 * model; a named model is ready only while the catalog still lists it.
 * @param {{ id: string }[]} models
 * @param {{ defaultFetchModel?: string | null, fetchOff?: boolean } | null} [config]
 * @returns {{ ready: boolean, key: string, model?: string }}
 */
export function fetchStatus(models, config) {
  if (config?.fetchOff) return { ready: false, key: "settings.status.off" };
  const listed = Array.isArray(models) ? models : [];
  const model = config?.defaultFetchModel ?? null;
  if (model === null) {
    return listed.length > 0
      ? { ready: true, key: "settings.status.router" }
      : { ready: false, key: "settings.status.empty" };
  }
  return listed.some((entry) => entry.id === model)
    ? { ready: true, key: "settings.status.ready", model }
    : { ready: false, key: "settings.status.notReady", model };
}

export function fetchModelLabel(model) {
  return model.name || model.id;
}

/**
 * Follow-Router first, then what Router serves, with off last. Router serving
 * nothing is reported by the status line, not by hiding the choice.
 */
export function fetchSelectorItems(models, { routerDefault, off }) {
  return [
    { id: FETCH_ROUTER_DEFAULT, label: routerDefault },
    ...models.map((model) => ({ id: model.id, label: fetchModelLabel(model) })),
    { id: FETCH_OFF, label: off },
  ];
}
