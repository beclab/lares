export const CONVERSATION_SETTINGS_NAMESPACE = "ui-conversation";
export const DEFAULT_BUSY_ENTER = "queue";

export function busyEnterBehavior(value) {
  return value === "steer" ? "steer" : DEFAULT_BUSY_ENTER;
}

export function resolveSubmitMode(running, accelerated, steeringAvailable, preferred) {
  if (!running || !steeringAvailable) return "queue";
  const busyEnter = busyEnterBehavior(preferred);
  if (!accelerated) return busyEnter;
  return busyEnter === "queue" ? "steer" : "queue";
}

export function conversationSettings(described) {
  const rows = Array.isArray(described?.namespaces) ? described.namespaces : [];
  const section = rows.find((row) => row?.ns === CONVERSATION_SETTINGS_NAMESPACE);
  if (!section) {
    return { busyEnter: DEFAULT_BUSY_ENTER, revision: undefined, writable: false };
  }
  return {
    busyEnter: busyEnterBehavior(section.value?.busyEnter),
    revision: Number.isInteger(section.revision) ? section.revision : undefined,
    writable: described?.writable !== false,
  };
}
