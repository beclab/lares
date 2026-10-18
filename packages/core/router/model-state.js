export function modelState({ status, groups = [], models, current, failures = [], error } = {}) {
  const entries = models ?? groups.flatMap((group) => group.models.map((model) => ({ ...model, provider: group.id })));
  const selected = current?.model?.trim();
  const placeholder = !selected || selected === "default";
  const found = !placeholder && entries.find((row) => row.provider === current.provider && row.id === selected);
  const effort = current?.reasoningEffort;
  const effortUnavailable = found && effort !== undefined
    && !(found.reasoning?.efforts?.some((row) => row.id === effort)
      || Object.hasOwn(found.reasoningEfforts ?? {}, effort));
  const state = error || failures.length ? "error"
    : status === "loading" || status === "idle" ? "loading"
      : selected && !found ? "unavailable"
        : !entries.length ? "empty"
          : placeholder ? "unselected" : effortUnavailable ? "effort-unavailable" : "ready";
  return { state, valid: Boolean(found) && state !== "loading" && state !== "error" && !effortUnavailable };
}

export function modelStateLabel(snapshot, locale = "en") {
  const { state } = modelState(snapshot);
  const zh = locale.startsWith("zh");
  const id = snapshot.current?.model;
  const name = id?.split("/").at(-1);
  if (state === "loading") return zh ? "正在加载模型" : "Loading models";
  if (state === "error") return zh ? `${name || "模型目录"} · 加载失败，请刷新` : `${name || "Models"} · refresh failed`;
  if (state === "unavailable") return zh ? `${name} · 不可用` : `${name} · unavailable`;
  if (state === "effort-unavailable") return zh ? `${name} · 思考档位 ${snapshot.current.reasoningEffort} 不可用` : `${name} · effort ${snapshot.current.reasoningEffort} unavailable`;
  if (state === "empty") return zh ? "暂无可用聊天模型" : "No chat models available";
  if (state === "unselected") return zh ? "请选择模型" : "Select a model";
  return name;
}

export function requireComposerModel(snapshot, locale) {
  if (modelState(snapshot).valid) return;
  throw new Error(modelStateLabel(snapshot, locale));
}
