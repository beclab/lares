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
  return current?.reasoningEffort ?? reasoning?.defaultEffort;
}

const EFFORT_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Router catalog dict `{ low: "low" }` → the effort menu shape the switcher already uses. */
export function reasoningFromEfforts(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  if (Array.isArray(raw.efforts)) {
    return raw.efforts.length ? raw : undefined;
  }
  const efforts = [];
  for (const id of EFFORT_ORDER) {
    if (raw[id] != null) efforts.push({ id, name: id });
  }
  if (!efforts.length) {
    for (const id of Object.keys(raw)) {
      if (typeof id === "string" && id) efforts.push({ id, name: id });
    }
  }
  if (!efforts.length) return undefined;
  return {
    efforts,
    defaultEffort: efforts.find((row) => row.id !== "off")?.id ?? efforts[0].id,
  };
}

export function reasoningOfModel(model) {
  return reasoningFromEfforts(model?.reasoning ?? model?.reasoningEfforts);
}

export function modelSwitchSelection(group, model) {
  return {
    provider: group.id,
    model: model.id,
    ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
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
  if (reasoning.defaultEffort === undefined) {
    items.push({ id: undefined, providerDefault: true });
  }
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

export function selectionKey(selection) {
  return `${selection.provider}\u0000${selection.model ?? selection.id}`;
}

export function groupModelsByProvider(models) {
  const groups = [];
  const index = new Map();
  for (const model of models) {
    let group = index.get(model.provider);
    if (group === undefined) {
      group = { provider: model.provider, models: [] };
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
