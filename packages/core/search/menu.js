export const SEARCH_NONE = "none";

export function searchDefaultReady(models, defaultSearchModel) {
  return Array.isArray(models) && models.some((model) => model.id === defaultSearchModel);
}

export function searchMenuValue(defaultSearchModel) {
  return defaultSearchModel ?? SEARCH_NONE;
}

export function searchValueFromMenu(id) {
  return id === SEARCH_NONE ? null : id;
}

export function searchModelLabel(model) {
  return model.name || model.id;
}

export function searchSelectorItems(models, { none, empty }) {
  if (models.length === 0) return [{ id: SEARCH_NONE, label: empty }];
  return [{ id: SEARCH_NONE, label: none }, ...models.map((model) => ({ id: model.id, label: searchModelLabel(model) }))];
}
