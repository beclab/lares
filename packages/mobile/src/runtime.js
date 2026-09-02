import { hostKey } from "@olares/lares-core/larepass/host";
import { resetHostSettingsCache } from "@olares/lares-core/larepass/settings";
import { createChatRuntime } from "@olares/lares-core/larepass/runtime";
import { createHostClient } from "./host.js";

let current = null;
let liveKey = "";

export function adoptHost(ports) {
  const key = hostKey(ports);
  if (key === liveKey) return key;
  liveKey = key;
  current?.dispose?.();
  current = null;
  resetHostSettingsCache();
  return key;
}

export function connectChat(ports) {
  const client = createHostClient(ports);
  const key = adoptHost(ports);
  if (current?.key === key) return current;
  current = Object.assign(createChatRuntime(client), { key });
  return current;
}

export function resetChatHost() {
  liveKey = "";
  current?.dispose?.();
  current = null;
  resetHostSettingsCache();
}
