export function isComposerModelAvailable(subagentAddress) {
  return subagentAddress === undefined;
}

export function bindComposerModelDirectory(directory, available) {
  return {
    available,
    directory: directory.store,
    load() {
      if (!available) return Promise.resolve();
      return directory.load().catch(() => {});
    },
    select(selection) {
      if (!available) return Promise.resolve(false);
      return directory.select(selection).then(
        () => true,
        () => false,
      );
    },
  };
}

export function findListedModel(groups, current) {
  if (!current) return undefined;
  for (const group of groups) {
    for (const model of group.models) {
      if (group.id === current.provider && model.id === current.model) return model;
    }
  }
  return undefined;
}

export function isSameSessionModel(current, group, model) {
  return Boolean(current && current.provider === group.id && current.model === model.id);
}

export function currentEffortId(current, reasoning) {
  return current?.reasoningEffort;
}

/** Router catalog dict `{ low: "low" }` → the effort menu shape the switcher already uses. */
export function reasoningFromEfforts(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  if (Array.isArray(raw.efforts)) {
    return raw.efforts.length ? raw : undefined;
  }
  const efforts = Object.keys(raw).filter((id) => id && typeof raw[id] === "string")
    .map((id) => ({ id, name: id }));
  if (!efforts.length) return undefined;
  return {
    efforts,
  };
}

export function reasoningOfModel(model) {
  return reasoningFromEfforts(model?.reasoning ?? model?.reasoningEfforts);
}

export function modelSwitchSelection(group, model) {
  return {
    provider: group.id,
    model: model.id,
  };
}

export function effortSwitchSelection(current, level) {
  return {
    provider: current.provider,
    model: current.model,
    ...(level === undefined ? {} : { reasoningEffort: level }),
  };
}

export function effortDisplayLabel(reasoning, effortId, defaultLabel) {
  if (reasoning === undefined) return undefined;
  if (effortId === undefined) return defaultLabel;
  return reasoning.efforts.find((level) => level.id === effortId)?.name ?? effortId;
}

export function sessionModelLabel(currentModel, current, selectLabel) {
  return currentModel?.name ?? current?.model ?? selectLabel;
}

export function effortMenuRows(reasoning, defaultLabel) {
  return effortMenuItems(reasoning).map((item) =>
    item.providerDefault
      ? { key: "provider-default", id: undefined, name: defaultLabel }
      : { key: `effort:${item.id}`, id: item.id, name: item.name, description: item.description },
  );
}

export function effortMenuItems(reasoning) {
  if (reasoning === undefined) return [];
  const items = [];
  items.push({ id: undefined, providerDefault: true });
  for (const effort of reasoning.efforts) {
    items.push({
      id: effort.id,
      providerDefault: false,
      name: effort.name,
      description: effort.description,
    });
  }
  return items;
}

/** The selection the composer shows: the session's pending choice, else the catalog default. */
export function sessionModelSelection(projection, catalogDefault) {
  const next = projection?.next;
  if (next && typeof next.provider === "string" && typeof next.model === "string") return next;
  if (
    catalogDefault
    && typeof catalogDefault.provider === "string"
    && typeof catalogDefault.model === "string"
  ) {
    return catalogDefault;
  }
  return null;
}

/**
 * `session.modelCatalog` → the flat list the composer already renders.
 * Reasoning stays on the model; that is the same metadata the desktop menu reads.
 */
export function composerModelsFromCatalog(catalog, selection) {
  if (!catalog || typeof catalog !== "object") return null;
  const models = [];
  for (const group of Array.isArray(catalog.groups) ? catalog.groups : []) {
    const provider = typeof group?.id === "string" ? group.id : "";
    if (!provider) continue;
    for (const model of group.models ?? []) {
      if (!model?.id || model.id === "default") continue;
      models.push({
        provider,
        providerName: group.name || provider,
        id: model.id,
        name: model.name || model.id,
        ...(model.description ? { description: model.description } : {}),
        ...(model.reasoning ? { reasoning: model.reasoning } : {}),
      });
    }
  }
  const current = selection ?? null;
  const routable = Boolean(
    current
    && models.some((model) => model.provider === current.provider && model.id === current.model),
  );
  return {
    default: current,
    routable,
    failures: (Array.isArray(catalog.failures) ? catalog.failures : []).map((entry) => ({
      provider: entry.provider ?? entry.id,
      name: entry.name,
      message: entry.message,
    })),
    models,
  };
}

export function selectionKey(selection) {
  return `${selection.provider}\u0000${selection.model ?? selection.id}`;
}

export function groupModelsByProvider(models) {
  const groups = [];
  const index = new Map();
  for (const model of models) {
    let group = index.get(model.provider);
    if (group === undefined) {
      group = { provider: model.provider, name: model.providerName || model.provider, models: [] };
      index.set(model.provider, group);
      groups.push(group);
    }
    group.models.push(model);
  }
  return groups;
}

export function catalogDefaultReady(models, defaultSelection) {
  if (!defaultSelection) return false;
  const current = selectionKey(defaultSelection);
  return models.some((model) => selectionKey({ provider: model.provider, model: model.id }) === current);
}
