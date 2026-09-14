export const SEARCH_ROUTER_DEFAULT = "router-default";
export const SEARCH_OFF = "off";

/** @param {{ defaultSearchModel?: string | null, searchOff?: boolean } | null} [config] */
export function searchMenuValue(config) {
  if (config?.searchOff) return SEARCH_OFF;
  return config?.defaultSearchModel ?? SEARCH_ROUTER_DEFAULT;
}

/** @param {string} id */
export function searchValueFromMenu(id) {
  if (id === SEARCH_OFF) return { defaultSearchModel: null, searchOff: true };
  if (id === SEARCH_ROUTER_DEFAULT) return { defaultSearchModel: null, searchOff: false };
  return { defaultSearchModel: id, searchOff: false };
}

export function searchDefaultReady(models, config) {
  return searchStatus(models, config).ready;
}

/**
 * What the settings panel says about web search, decided once for every
 * surface. Following Router is ready as soon as Router serves any search
 * model; a named model is ready only while the catalog still lists it.
 * @param {{ id: string }[]} models
 * @param {{ defaultSearchModel?: string | null, searchOff?: boolean } | null} [config]
 * @returns {{ ready: boolean, key: string, model?: string }}
 */
export function searchStatus(models, config) {
  if (config?.searchOff) return { ready: false, key: "settings.status.off" };
  const listed = Array.isArray(models) ? models : [];
  const model = config?.defaultSearchModel ?? null;
  if (model === null) {
    return listed.length > 0
      ? { ready: true, key: "settings.status.router" }
      : { ready: false, key: "settings.status.empty" };
  }
  return listed.some((entry) => entry.id === model)
    ? { ready: true, key: "settings.status.ready", model }
    : { ready: false, key: "settings.status.notReady", model };
}

export function searchModelLabel(model) {
  return model.name || model.id;
}

/**
 * Follow-Router first, then what Router serves, with off last. Router serving
 * nothing is reported by the status line, not by hiding the choice.
 */
export function searchSelectorItems(models, { routerDefault, off }) {
  return [
    { id: SEARCH_ROUTER_DEFAULT, label: routerDefault },
    ...models.map((model) => ({ id: model.id, label: searchModelLabel(model) })),
    { id: SEARCH_OFF, label: off },
  ];
}
